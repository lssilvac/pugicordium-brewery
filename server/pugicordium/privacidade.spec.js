/*
 * Testes do fechamento da instância privada.
 *
 * Integração: monta um Express de verdade com o middleware e bate nele com
 * supertest. Não mocka o Express — mockar o framework testaria o mock.
 */

import express from 'express';
import request from 'supertest';

import { privacidade } from './privacidade.js';

/** App mínimo com o middleware e uma rota-sentinela por trás dele. */
function fazApp() {
	const app = express();

	app.use(privacidade);
	// Sentinelas: se o middleware deixar passar, estas respondem 200.
	app.get('/api/vault', (req, res)=>res.json({ vazou: true }));
	app.get('/vault', (req, res)=>res.send('vazou'));
	app.get('/admin', (req, res)=>res.send('vazou'));
	app.get('/share/abc', (req, res)=>res.send('ok'));
	app.get('/api/v1/brews', (req, res)=>res.json({ ok: true }));

	return app;
}

const original = process.env.PUGICORDIUM_PRIVADO;

afterEach(()=>{
	if(original === undefined) delete process.env.PUGICORDIUM_PRIVADO;
	else process.env.PUGICORDIUM_PRIVADO = original;
});

describe('rotas fechadas numa instância privada', ()=>{
	/*
	 * O Vault do Homebrewery lista título, descrição, autores e tags de todo
	 * brew publicado SEM autenticação. Numa instância pública com milhares de
	 * brews isso é o produto. Aqui é o background de uma personagem, numa
	 * máquina na internet aberta.
	 *
	 * Esconder o item de menu por CSS não fecha nada: a URL continua servindo.
	 * Estes testes existem para que ninguém "simplifique" isso de volta para
	 * uma regra de CSS.
	 */
	it.each([
		['/api/vault', 'a API do vault expõe o acervo inteiro sem autenticação'],
		['/vault',     'a página do vault lista brews publicados'],
		['/admin',     'o painel administrativo do upstream'],
	])('devolve 404 em %s', async (rota)=>{
		delete process.env.PUGICORDIUM_PRIVADO;

		await request(fazApp()).get(rota).expect(404);
	});

	it('responde 404 e não 403, para não confirmar que a rota existe', async ()=>{
		// 403 conta a quem sondava que há algo ali. 404 não conta nada.
		delete process.env.PUGICORDIUM_PRIVADO;

		const resposta = await request(fazApp()).get('/api/vault');

		expect(resposta.status).toBe(404);
		expect(resposta.status).not.toBe(403);
	});

	it('devolve erro em JSON quando o cliente pede JSON', async ()=>{
		// Um cliente de máquina que recebe HTML não consegue reagir.
		delete process.env.PUGICORDIUM_PRIVADO;

		const resposta = await request(fazApp())
			.get('/api/vault')
			.set('Accept', 'application/json')
			.expect(404);

		expect(resposta.body.erro.codigo).toBe('rota_indisponivel');
		expect(resposta.body.erro.acao).toMatch(/api\/v1/);
	});
});

describe('rotas que continuam abertas', ()=>{
	it('não bloqueia /share, que é como o material é entregue', async ()=>{
		/*
		 * O compartilhamento por link é o produto. Se o fechamento pegasse
		 * /share, o material deixaria de chegar ao mestre — que é o ponto de
		 * existir tudo isto.
		 */
		delete process.env.PUGICORDIUM_PRIVADO;

		await request(fazApp()).get('/share/abc').expect(200);
	});

	it('não bloqueia /api/v1, que tem autenticação própria', async ()=>{
		delete process.env.PUGICORDIUM_PRIVADO;

		await request(fazApp()).get('/api/v1/brews').expect(200);
	});
});

describe('desligar o fechamento', ()=>{
	it('deixa o vault passar quando PUGICORDIUM_PRIVADO=false', async ()=>{
		// O fork deve continuar servindo para quem queira uma instância
		// pública a partir dele.
		process.env.PUGICORDIUM_PRIVADO = 'false';

		await request(fazApp()).get('/api/vault').expect(200);
	});

	it('fecha por padrão quando a env não está definida', async ()=>{
		// O padrão seguro importa: esquecer de configurar não pode abrir o
		// acervo.
		delete process.env.PUGICORDIUM_PRIVADO;

		await request(fazApp()).get('/api/vault').expect(404);
	});
});
