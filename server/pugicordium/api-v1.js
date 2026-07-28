/*
 * API v1 do Pugicordium — a camada que uma IA consegue usar.
 *
 * Existe separada da API do upstream de propósito. As duas convivem: a
 * original serve o editor no navegador, com sessão e editId; esta serve
 * máquina, com chave. Nenhuma rota do upstream é tocada.
 *
 * O que o PLANO.md exige de "amigável para MCP", e onde está cada item:
 *
 *   chave de API, não sessão ......... chaves.js
 *   contrato versionado .............. o /v1 deste arquivo
 *   idempotência ..................... Idempotency-Key no POST; PUT não faz upsert
 *   erro legível por máquina ......... erros.js
 *   leitura antes de escrita ......... as rotas GET são as primeiras e mais completas
 *   dry-run em tudo que escreve ...... ?dryRun=true
 */

import express from 'express';
import crypto  from 'crypto';
import mongoose from 'mongoose';
import zlib    from 'zlib';

import { model as Homebrew } from '../homebrew.model.js';
import { autenticar, exigir, ESCOPOS } from './chaves.js';
import { erros } from './erros.js';
import { medirPaginacao } from './paginacao.js';

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Idempotência
 *
 * Guarda a resposta de um POST por 24h, indexada pela chave que o cliente
 * mandou. Repetir o mesmo POST com a mesma chave devolve a MESMA resposta
 * em vez de criar um segundo brew — que é exatamente o modo de falha de uma
 * IA que repete por timeout.
 * ------------------------------------------------------------------ */

const IdempotenciaSchema = new mongoose.Schema({
	chave     : { type: String, required: true, index: { unique: true } },
	resposta  : { type: Object, required: true },
	criadaEm  : { type: Date, default: Date.now, expires: 60 * 60 * 24 },
}, { versionKey: false, collection: 'pugicordiumIdempotencia' });

const Idempotencia = mongoose.models.PugicordiumIdempotencia
	|| mongoose.model('PugicordiumIdempotencia', IdempotenciaSchema);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const ehVerdadeiro = (v)=>v === true || v === 'true' || v === '1';

/** Projeção pública de um brew. Nunca devolve editId em rota de leitura. */
function paraSaida(brew, { incluirEditId = false } = {}) {
	return {
		shareId     : brew.shareId,
		...(incluirEditId ? { editId: brew.editId } : {}),
		titulo      : brew.title,
		descricao   : brew.description,
		tags        : brew.tags ?? [],
		autores     : brew.authors ?? [],
		idioma      : brew.lang,
		renderer    : brew.renderer || 'V3',
		tema        : brew.theme ?? null,
		publicado   : brew.published,
		paginas     : brew.pageCount,
		criadoEm    : brew.createdAt,
		atualizadoEm: brew.updatedAt,
	};
}

/** Acha por shareId ou editId — a IA não deveria precisar saber qual tem. */
async function acharBrew(id) {
	try {
		return await Homebrew.get({ $or: [{ shareId: id }, { editId: id }] });
	} catch (e) {
		return null;
	}
}

function validarTexto(texto) {
	if(typeof texto !== 'string') return 'precisa ser string';
	if(texto.length > 5 * 1024 * 1024) return 'passa de 5 MB';

	return null;
}

/* ================================================================== *
 * LEITURA — vem primeiro de propósito.
 *
 * O PLANO.md diz: "ferramentas de leitura antes das de escrita — o ganho
 * maior não é criar brew, é conferir o que criou".
 * ================================================================== */

router.get('/brews', autenticar, exigir(ESCOPOS.LER), async (req, res)=>{
	const limite = Math.min(parseInt(req.query.limite) || 20, 100);
	const busca  = (req.query.busca || '').trim();

	const filtro = busca ? { title: { $regex: busca, $options: 'i' } } : {};

	try {
		const brews = await Homebrew
			.find(filtro, 'shareId title description tags authors lang renderer published pageCount createdAt updatedAt')
			.sort({ updatedAt: -1 })
			.limit(limite)
			.lean()
			.exec();

		return res.json({
			total : brews.length,
			brews : brews.map((b)=>paraSaida(b)),
		});
	} catch (e) {
		return erros.interno(res, e.message);
	}
});

router.get('/brews/:id', autenticar, exigir(ESCOPOS.LER), async (req, res)=>{
	const brew = await acharBrew(req.params.id);

	if(!brew) return erros.brewNaoEncontrado(res, req.params.id);

	return res.json({
		...paraSaida(brew),
		texto : brew.text,
		estilo: brew.style ?? '',
	});
});

/** Medição de um brew que já existe. Não grava nada. */
router.get('/brews/:id/paginacao', autenticar, exigir(ESCOPOS.MEDIR), async (req, res)=>{
	const brew = await acharBrew(req.params.id);

	if(!brew) return erros.brewNaoEncontrado(res, req.params.id);

	return res.json(medirPaginacao(brew.text, brew.renderer || 'V3'));
});

/** Medição de um texto solto, sem precisar salvar antes. É o que fecha o
 *  loop de escrita: a IA escreve, mede, corta o que estourou, remede. */
router.post('/medir', autenticar, exigir(ESCOPOS.MEDIR), (req, res)=>{
	const { texto, renderer } = req.body ?? {};
	const problema = validarTexto(texto);

	if(problema) return erros.campoInvalido(res, 'texto', problema);

	return res.json(medirPaginacao(texto, renderer === 'legacy' ? 'legacy' : 'V3'));
});

/* ================================================================== *
 * ESCRITA — tudo aceita ?dryRun=true
 * ================================================================== */

router.post('/brews', autenticar, exigir(ESCOPOS.ESCREVER), async (req, res)=>{
	const { titulo, texto, descricao, tags, renderer, publicado } = req.body ?? {};
	const dryRun = ehVerdadeiro(req.query.dryRun);
	const chaveIdem = req.get('Idempotency-Key');

	const problema = validarTexto(texto ?? '');

	if(problema) return erros.campoInvalido(res, 'texto', problema);
	if(typeof titulo !== 'string' || !titulo.trim()) {
		return erros.campoInvalido(res, 'titulo', 'é obrigatório e não pode ser vazio');
	}

	// Repetição da mesma chave devolve a resposta original, sem criar de novo.
	if(chaveIdem && !dryRun) {
		const anterior = await Idempotencia.findOne({ chave: chaveIdem }).lean().exec();

		if(anterior) return res.status(200).json({ ...anterior.resposta, repetido: true });
	}

	const medicao = medirPaginacao(texto ?? '', renderer === 'legacy' ? 'legacy' : 'V3');

	if(dryRun) {
		return res.json({
			dryRun    : true,
			gravou    : false,
			seria     : { titulo, paginas: medicao.paginas },
			paginacao : medicao,
		});
	}

	try {
		const novo = new Homebrew({
			title       : titulo,
			text        : texto ?? '',
			description : descricao ?? '',
			tags        : Array.isArray(tags) ? tags : [],
			renderer    : renderer === 'legacy' ? 'legacy' : 'V3',
			published   : publicado === true,
			pageCount   : medicao.paginas,
		});

		// mesmo tratamento do upstream: texto vai comprimido
		novo.textBin = zlib.deflateRawSync(novo.text);
		novo.text = undefined;

		await novo.save();

		const resposta = {
			...paraSaida(novo, { incluirEditId: true }),
			paginacao : medicao,
		};

		if(chaveIdem) {
			await Idempotencia.create({ chave: chaveIdem, resposta }).catch(()=>{});
		}

		return res.status(201).json(resposta);
	} catch (e) {
		return erros.interno(res, e.message);
	}
});

/*
 * PUT só atualiza — NÃO faz upsert.
 *
 * O Homebrewery tem dois ids por brew, e o editId é a credencial de escrita.
 * Um upsert num id inexistente teria de inventar um editId, e o cliente que
 * fez o PUT não o receberia de volta de forma idempotente. Criar é POST.
 */
router.put('/brews/:id', autenticar, exigir(ESCOPOS.ESCREVER), async (req, res)=>{
	const dryRun = ehVerdadeiro(req.query.dryRun);
	const brew = await acharBrew(req.params.id);

	if(!brew) return erros.brewNaoEncontrado(res, req.params.id);

	const { titulo, texto, descricao, tags, publicado } = req.body ?? {};

	if(texto !== undefined) {
		const problema = validarTexto(texto);

		if(problema) return erros.campoInvalido(res, 'texto', problema);
	}

	const textoFinal = texto !== undefined ? texto : brew.text;
	const medicao = medirPaginacao(textoFinal, brew.renderer || 'V3');

	if(dryRun) {
		return res.json({
			dryRun    : true,
			gravou    : false,
			shareId   : brew.shareId,
			seria     : { titulo: titulo ?? brew.title, paginas: medicao.paginas },
			paginacao : medicao,
		});
	}

	try {
		if(titulo !== undefined)    brew.title = titulo;
		if(descricao !== undefined) brew.description = descricao;
		if(tags !== undefined)      brew.tags = Array.isArray(tags) ? tags : [];
		if(publicado !== undefined) brew.published = publicado === true;

		if(texto !== undefined) {
			brew.text = texto;
			brew.textBin = zlib.deflateRawSync(texto);
		}

		brew.pageCount = medicao.paginas;
		brew.updatedAt = new Date();

		// o campo text não é persistido quando há textBin
		const paraSalvar = brew;

		paraSalvar.text = undefined;
		await paraSalvar.save();

		return res.json({ ...paraSaida(brew), paginacao: medicao });
	} catch (e) {
		return erros.interno(res, e.message);
	}
});

/* ================================================================== *
 * Descoberta — o que impede a IA de inventar sintaxe
 * ================================================================== */

router.get('/temas', autenticar, exigir(ESCOPOS.LER), async (req, res)=>{
	try {
		const { default: temas } = await import('../../themes/themes.json', { with: { type: 'json' } });

		const lista = [];

		for (const [renderer, conjunto] of Object.entries(temas)) {
			for (const [nome, dados] of Object.entries(conjunto)) {
				lista.push({ renderer, nome, rotulo: dados.name ?? nome, baseado: dados.baseTheme ?? null });
			}
		}

		return res.json({ total: lista.length, temas: lista });
	} catch (e) {
		return erros.interno(res, e.message);
	}
});

export default router;
