/*
 * Autenticação por chave de API.
 *
 * Este é o bloqueio nº 1 do PLANO.md: a autorização do Homebrewery é sessão
 * JWT do NaturalCrit ou posse do editId. Uma IA não faz login com Google.
 *
 * Decisões:
 *
 * 1. O banco guarda o HASH da chave, nunca o valor. Vazamento de dump não
 *    vira acesso. SHA-256 basta aqui — a chave tem 256 bits de entropia de
 *    CSPRNG, então não há o que forçar por dicionário, que é o motivo de
 *    senha humana precisar de bcrypt/argon.
 *
 * 2. O middleware NÃO popula req.account. server/app.js:97 decodifica o
 *    cookie nc_session para todo request e monta req.account a partir dele.
 *    Se a chave também escrevesse ali, os dois modelos de autenticação —
 *    que devem conviver — ficariam acoplados, e uma mudança no login do
 *    NaturalCrit passaria a afetar a API de máquina. A chave vive em
 *    req.chavePugicordium.
 *
 * 3. Escopos são verificados por rota, não globalmente. Ferramenta de leitura
 *    não deve poder escrever só porque a chave também tem escopo de escrita
 *    em outra rota.
 */

import crypto   from 'crypto';
import mongoose from 'mongoose';
import { erros } from './erros.js';

export const ESCOPOS = {
	LER      : 'brews:ler',
	ESCREVER : 'brews:escrever',
	MEDIR    : 'render:medir',
};

const ChaveSchema = new mongoose.Schema({
	// hash sha-256 do valor; o valor em si não é guardado em lugar nenhum
	hash      : { type: String, required: true, index: { unique: true } },
	// prefixo legível, só para o humano reconhecer a chave numa lista
	prefixo   : { type: String, required: true },
	nome      : { type: String, required: true },
	escopos   : { type: [String], default: [] },
	criadaEm  : { type: Date, default: Date.now },
	usadaEm   : { type: Date, default: null },
	revogada  : { type: Boolean, default: false, index: true },
}, { versionKey: false, collection: 'pugicordiumApiKeys' });

export const Chave = mongoose.models.PugicordiumApiKey
	|| mongoose.model('PugicordiumApiKey', ChaveSchema);

const PREFIXO = 'pgc_';

export function calcularHash(valor) {
	return crypto.createHash('sha256').update(valor, 'utf8').digest('hex');
}

/**
 * Gera uma chave nova. Devolve o valor em claro UMA vez — depois disso só
 * existe o hash, e nem o servidor consegue recuperá-lo.
 */
export async function gerarChave({ nome, escopos }) {
	const valor = PREFIXO + crypto.randomBytes(32).toString('base64url');

	const chave = await Chave.create({
		hash    : calcularHash(valor),
		prefixo : valor.slice(0, PREFIXO.length + 6),
		nome,
		escopos,
	});

	return { valor, id: chave._id, prefixo: chave.prefixo };
}

/**
 * Middleware de autenticação. Não decide escopo — só identifica quem é.
 */
export async function autenticar(req, res, next) {
	const enviada = req.get('X-Pugicordium-Key');

	if(!enviada) return erros.chaveAusente(res);

	let chave;

	try {
		chave = await Chave.findOne({ hash: calcularHash(enviada), revogada: false }).exec();
	} catch (e) {
		return erros.interno(res, 'falha ao consultar as chaves');
	}

	if(!chave) return erros.chaveInvalida(res);

	req.chavePugicordium = chave;

	// Registra o uso sem bloquear a resposta: saber que uma chave está viva
	// é útil para revogar as mortas, mas não vale segurar o request.
	Chave.updateOne({ _id: chave._id }, { $set: { usadaEm: new Date() } }).exec().catch(()=>{});

	return next();
}

/**
 * Exige um escopo. Use por rota:
 *   router.get('/brews', autenticar, exigir(ESCOPOS.LER), handler)
 */
export function exigir(escopo) {
	return (req, res, next)=>{
		const chave = req.chavePugicordium;

		if(!chave) return erros.chaveAusente(res);
		if(!chave.escopos.includes(escopo)) return erros.semEscopo(res, escopo);

		return next();
	};
}
