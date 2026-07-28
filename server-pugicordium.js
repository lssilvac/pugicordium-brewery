/*
 * Entrypoint do Pugicordium.
 *
 * ==================== POR QUE NÃO É UMA LINHA EM app.js ====================
 *
 * Para montar rotas novas, elas precisam vir ANTES dos handlers do upstream —
 * server/app.js registra um catch-all (linha ~547 e ~651) que manda qualquer
 * caminho desconhecido para a HomePage. Montar depois de createApp() não
 * adianta: o catch-all já respondeu.
 *
 * O caminho óbvio seria uma linha em server/app.js. Mas esse arquivo tem 235
 * commits — é o mais volátil do servidor, e um ponto de conflito recorrente.
 *
 * A saída é esta: um app Express PRÓPRIO que monta nosso router primeiro e
 * usa o app do Homebrewery como middleware final. Um app Express é um
 * middleware válido, então `app.use(appDoUpstream)` delega tudo que não
 * casamos. Resultado: as rotas novas vêm antes, o upstream continua
 * intocado, e o custo de merge deste módulo é ZERO — é arquivo novo.
 *
 * O Dockerfile.pugicordium aponta o CMD para cá.
 */

import express from 'express';

import DB        from './server/db.js';
import createApp from './server/app.js';
import config    from './server/config.js';

import apiV1          from './server/pugicordium/api-v1.js';
import mcp            from './server/pugicordium/mcp.js';
import { privacidade } from './server/pugicordium/privacidade.js';

const ambientesDeDesenvolvimento = config.get('local_environments');
const ehDesenvolvimento = ambientesDeDesenvolvimento.includes(process.env.NODE_ENV);

async function iniciar() {
	let vite;

	if(ehDesenvolvimento) {
		const { createServer } = await import('vite');

		vite = await createServer({
			server  : { middlewareMode: true },
			appType : 'custom',
		});
	}

	await DB.connect(config).catch((erro)=>{
		console.error('Falha ao conectar no banco:', erro);
		process.exit(1);
	});

	const app = express();

	// O body parser precisa vir antes do nosso router; o app do upstream tem
	// o dele, mas ele só roda quando delegamos, o que é tarde demais.
	app.use(express.json({ limit: '25mb' }));

	// 1. Privacidade: fecha o que não deve existir numa instância privada.
	app.use(privacidade);

	// 2. API v1: autenticada por chave, contrato versionado.
	app.use('/api/v1', apiV1);

	// 3. MCP: mesmo núcleo, transporte Streamable HTTP. Claude Code e Claude
	//    Desktop falam isto; ChatGPT e Codex usam o /api/v1 direto.
	app.use('/mcp', mcp);

	// 4. Homebrewery inteiro, como middleware. Tudo que não casou acima cai
	//    aqui e é tratado exatamente como o upstream trata.
	const appHomebrewery = await createApp(vite);

	app.use(appHomebrewery);

	const porta = process.env.PORT || config.get('web_port') || 8000;

	app.listen(porta, ()=>{
		console.log(`\n\tPugicordium Brewery em pé na porta ${porta}`);
		console.log(`\tambiente: ${process.env.NODE_ENV}`);
		console.log(`\tAPI: /api/v1/  (header X-Pugicordium-Key)\n`);
	});
}

iniciar();
