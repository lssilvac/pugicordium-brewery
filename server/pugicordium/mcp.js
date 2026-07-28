/*
 * Servidor MCP do Pugicordium.
 *
 * Transporte: Streamable HTTP — o mesmo que o Coolify usa, e o que Claude
 * Code, Claude Desktop e qualquer cliente MCP moderno falam. Implementado à
 * mão, em JSON-RPC 2.0 sobre POST, para não adicionar dependência: o SDK
 * oficial traria uma árvore inteira para o que aqui são ~200 linhas.
 *
 * Para ChatGPT e Codex, o caminho não é este endpoint e sim o /api/v1/
 * direto — foi por isso que o contrato veio versionado e com erro legível
 * por máquina. As duas portas servem o mesmo núcleo.
 *
 * A autenticação é a MESMA da API v1: header X-Pugicordium-Key. Um cliente
 * MCP que fale Authorization: Bearer também é aceito, porque é o que a
 * maioria manda por padrão.
 *
 * ORDEM DAS FERRAMENTAS: leitura primeiro, e de propósito. O PLANO.md diz
 * que "o ganho maior não é criar brew, é conferir o que criou". A ordem da
 * lista influencia a escolha do modelo.
 */

import express from 'express';

import { model as Homebrew } from '../homebrew.model.js';
import { Chave, calcularHash, ESCOPOS } from './chaves.js';
import { medirPaginacao } from './paginacao.js';

const router = express.Router();

const PROTOCOLO = '2024-11-05';

/* ------------------------------------------------------------------ *
 * Definição das ferramentas
 * ------------------------------------------------------------------ */

const FERRAMENTAS = [
	{
		name        : 'brew_listar',
		description : 'Lista os brews da instância, do mais recente para o mais antigo. '
		            + 'Use antes de criar qualquer coisa, para saber o que já existe.',
		escopo      : ESCOPOS.LER,
		inputSchema : {
			type       : 'object',
			properties : {
				busca  : { type: 'string', description: 'filtra por parte do título' },
				limite : { type: 'number', description: 'máximo de resultados (padrão 20, teto 100)' },
			},
		},
	},
	{
		name        : 'brew_ler',
		description : 'Lê o markdown e os metadados de um brew. Aceita shareId ou editId.',
		escopo      : ESCOPOS.LER,
		inputSchema : {
			type       : 'object',
			properties : { id: { type: 'string', description: 'shareId ou editId' } },
			required   : ['id'],
		},
	},
	{
		name        : 'brew_medir',
		description : 'Mede a paginação de um texto SEM gravar nada: quantas páginas, '
		            + 'onde cada uma começa e termina, e quais estão no limite. '
		            + 'É a ferramenta que fecha o ciclo de escrita — escreva, meça, '
		            + 'corte o que estourou, meça de novo.',
		escopo      : ESCOPOS.MEDIR,
		inputSchema : {
			type       : 'object',
			properties : {
				texto    : { type: 'string', description: 'markdown do brew' },
				renderer : { type: 'string', enum: ['V3', 'legacy'], description: 'padrão V3' },
			},
			required   : ['texto'],
		},
	},
	{
		name        : 'tema_listar',
		description : 'Lista os temas disponíveis nesta instância, por renderer.',
		escopo      : ESCOPOS.LER,
		inputSchema : { type: 'object', properties: {} },
	},
	{
		name        : 'snippet_buscar',
		description : 'Devolve a sintaxe correta dos blocos do tema — tabelas, notas, '
		            + 'quadros. Consulte ANTES de escrever uma tag: inventar sintaxe '
		            + 'quebra o render, e o material desta campanha proíbe alterar as '
		            + 'tags do tema do mestre.',
		escopo      : ESCOPOS.LER,
		inputSchema : {
			type       : 'object',
			properties : {
				termo : { type: 'string', description: 'parte do nome do snippet' },
				tema  : { type: 'string', description: 'nome do tema (padrão 5ePHB)' },
			},
		},
	},
	{
		name        : 'brew_criar',
		description : 'Cria um brew. Use dryRun=true primeiro para ver quantas páginas '
		            + 'daria sem gravar nada.',
		escopo      : ESCOPOS.ESCREVER,
		inputSchema : {
			type       : 'object',
			properties : {
				titulo : { type: 'string' },
				texto  : { type: 'string' },
				dryRun : { type: 'boolean', description: 'ensaia sem gravar' },
			},
			required   : ['titulo', 'texto'],
		},
	},
	{
		name        : 'brew_atualizar',
		description : 'Atualiza um brew existente. Não cria: para criar, use brew_criar. '
		            + 'Aceita dryRun=true.',
		escopo      : ESCOPOS.ESCREVER,
		inputSchema : {
			type       : 'object',
			properties : {
				id     : { type: 'string', description: 'shareId ou editId' },
				titulo : { type: 'string' },
				texto  : { type: 'string' },
				dryRun : { type: 'boolean' },
			},
			required   : ['id'],
		},
	},
];

/* ------------------------------------------------------------------ *
 * Execução
 * ------------------------------------------------------------------ */

async function acharBrew(id) {
	try {
		return await Homebrew.get({ $or: [{ shareId: id }, { editId: id }] });
	} catch (e) {
		return null;
	}
}

async function executar(nome, args, chave) {
	const ferramenta = FERRAMENTAS.find((f)=>f.name === nome);

	if(!ferramenta) throw new Error(`Ferramenta desconhecida: ${nome}`);

	if(!chave.escopos.includes(ferramenta.escopo)) {
		throw new Error(`A chave não tem o escopo "${ferramenta.escopo}", exigido por ${nome}.`);
	}

	switch (nome) {
		case 'brew_listar': {
			const limite = Math.min(args.limite || 20, 100);
			const filtro = args.busca ? { title: { $regex: args.busca, $options: 'i' } } : {};
			const brews = await Homebrew
				.find(filtro, 'shareId title description tags pageCount updatedAt')
				.sort({ updatedAt: -1 }).limit(limite).lean().exec();

			return { total: brews.length, brews };
		}

		case 'brew_ler': {
			const brew = await acharBrew(args.id);

			if(!brew) throw new Error(`Nenhum brew com o id "${args.id}".`);

			return {
				shareId : brew.shareId,
				titulo  : brew.title,
				texto   : brew.text,
				paginas : brew.pageCount,
			};
		}

		case 'brew_medir':
			return medirPaginacao(args.texto, args.renderer === 'legacy' ? 'legacy' : 'V3');

		case 'tema_listar': {
			const { default: temas } = await import('../../themes/themes.json', { with: { type: 'json' } });
			const lista = [];

			for (const [renderer, conjunto] of Object.entries(temas)) {
				for (const [chaveTema, dados] of Object.entries(conjunto)) {
					lista.push({ renderer, nome: chaveTema, rotulo: dados.name ?? chaveTema });
				}
			}

			return { temas: lista };
		}

		case 'snippet_buscar': {
			const tema = args.tema || '5ePHB';
			const termo = (args.termo || '').toLowerCase();

			const { default: snippets } = await import(`../../themes/V3/${tema}/snippets.js`)
				.catch(()=>({ default: [] }));

			const achados = [];

			for (const grupo of snippets) {
				for (const s of (grupo.snippets ?? [])) {
					if(termo && !s.name?.toLowerCase().includes(termo)) continue;

					achados.push({
						grupo : grupo.groupName,
						nome  : s.name,
						// snippet pode ser função (gera dinamicamente) ou string
						sintaxe : typeof s.gen === 'string' ? s.gen : '(gerado dinamicamente)',
					});
				}
			}

			return { tema, total: achados.length, snippets: achados.slice(0, 40) };
		}

		case 'brew_criar': {
			const medicao = medirPaginacao(args.texto);

			if(args.dryRun) return { dryRun: true, gravou: false, paginacao: medicao };

			const zlib = await import('zlib');
			const novo = new Homebrew({
				title     : args.titulo,
				text      : args.texto,
				pageCount : medicao.paginas,
			});

			novo.textBin = zlib.deflateRawSync(novo.text);
			novo.text = undefined;
			await novo.save();

			return { shareId: novo.shareId, editId: novo.editId, paginacao: medicao };
		}

		case 'brew_atualizar': {
			const brew = await acharBrew(args.id);

			if(!brew) throw new Error(`Nenhum brew com o id "${args.id}".`);

			const textoFinal = args.texto !== undefined ? args.texto : brew.text;
			const medicao = medirPaginacao(textoFinal, brew.renderer || 'V3');

			if(args.dryRun) {
				return { dryRun: true, gravou: false, shareId: brew.shareId, paginacao: medicao };
			}

			const zlib = await import('zlib');

			if(args.titulo !== undefined) brew.title = args.titulo;

			if(args.texto !== undefined) brew.textBin = zlib.deflateRawSync(args.texto);

			brew.pageCount = medicao.paginas;
			brew.updatedAt = new Date();
			brew.text = undefined;
			await brew.save();

			return { shareId: brew.shareId, paginacao: medicao };
		}

		default:
			throw new Error(`Ferramenta não implementada: ${nome}`);
	}
}

/* ------------------------------------------------------------------ *
 * Transporte JSON-RPC
 * ------------------------------------------------------------------ */

function resultado(id, result) {
	return { jsonrpc: '2.0', id, result };
}

function falha(id, codigo, mensagem) {
	return { jsonrpc: '2.0', id, error: { code: codigo, message: mensagem } };
}

router.post('/', async (req, res)=>{
	// Aceita o header próprio e o Bearer, que é o que a maioria dos clientes
	// MCP manda por padrão.
	const bruto = req.get('X-Pugicordium-Key')
		|| (req.get('Authorization') || '').replace(/^Bearer /i, '');

	const { id = null, method, params = {} } = req.body ?? {};

	// initialize responde sem autenticação: é o handshake, e recusá-lo faria
	// o cliente reportar "servidor indisponível" em vez de "chave inválida".
	if(method === 'initialize') {
		return res.json(resultado(id, {
			protocolVersion : PROTOCOLO,
			capabilities    : { tools: {} },
			serverInfo      : { name: 'pugicordium-brewery', version: '1.0.0' },
		}));
	}

	if(method === 'notifications/initialized') return res.status(204).end();

	if(!bruto) return res.status(401).json(falha(id, -32001, 'Envie X-Pugicordium-Key.'));

	const chave = await Chave.findOne({ hash: calcularHash(bruto), revogada: false }).exec();

	if(!chave) return res.status(401).json(falha(id, -32001, 'Chave inválida ou revogada.'));

	if(method === 'tools/list') {
		return res.json(resultado(id, {
			tools : FERRAMENTAS
				// só anuncia o que a chave pode de fato usar
				.filter((f)=>chave.escopos.includes(f.escopo))
				.map(({ name, description, inputSchema })=>({ name, description, inputSchema })),
		}));
	}

	if(method === 'tools/call') {
		try {
			const saida = await executar(params.name, params.arguments ?? {}, chave);

			return res.json(resultado(id, {
				content : [{ type: 'text', text: JSON.stringify(saida, null, 2) }],
			}));
		} catch (e) {
			// isError deixa o modelo ver a mensagem e corrigir, em vez de a
			// chamada sumir num erro de transporte
			return res.json(resultado(id, {
				content : [{ type: 'text', text: e.message }],
				isError : true,
			}));
		}
	}

	return res.status(400).json(falha(id, -32601, `Método desconhecido: ${method}`));
});

export default router;
export { FERRAMENTAS };
