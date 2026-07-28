/*
 * Testes da autenticação por chave.
 *
 * O mongoose é mockado porque estes testes verificam REGRA, não persistência:
 * que o valor em claro nunca é guardado, que escopo é conferido por rota, e
 * que a chave não vaza para req.account. Subir um Mongo para isso testaria o
 * Mongo.
 *
 * Padrão do repo `carisma`: mocka só a fronteira, preservando o resto do
 * módulo com requireActual.
 */

import express from 'express';
import request from 'supertest';

// jest.mock é içado acima dos imports pelo babel-jest, então o import
// estático de ./chaves.js abaixo já recebe o mongoose falso.
import { autenticar, exigir, ESCOPOS, calcularHash, gerarChave } from './chaves.js';

const mockChaves = new Map();

jest.mock('mongoose', ()=>{
	const real = jest.requireActual('mongoose');

	class SchemaFalso {
		constructor() {}
	}

	return {
		...real,
		models : {},
		Schema : SchemaFalso,
		model  : ()=>({
			findOne : (query)=>({
				exec : async ()=>mockChaves.get(query.hash) ?? null,
			}),
			updateOne : ()=>({ exec: async ()=>{} }),
			create : async (dados)=>dados,
			countDocuments : async ()=>mockChaves.size,
		}),
	};
});


/** Registra uma chave utilizável pelos testes. */
function registraChave({ valor, escopos = [ESCOPOS.LER], revogada = false }) {
	const registro = { _id: 'id-' + valor, escopos, revogada, nome: 'teste' };

	mockChaves.set(calcularHash(valor), revogada ? null : registro);

	return registro;
}

function fazApp(escopoExigido = ESCOPOS.LER) {
	const app = express();

	app.get('/protegida', autenticar, exigir(escopoExigido), (req, res)=>{
		res.json({
			ok             : true,
			temChave       : Boolean(req.chavePugicordium),
			// account precisa continuar indefinido; ver o teste de isolamento
			temAccount     : req.account !== undefined,
		});
	});

	return app;
}

beforeEach(()=>mockChaves.clear());

describe('o valor da chave nunca é armazenado', ()=>{
	it('guarda apenas o hash, e o hash não permite recuperar a chave', async ()=>{
		/*
		 * A regra existe para que vazamento de dump do banco não vire acesso.
		 * Se alguém trocar o hash por texto em claro "para facilitar o
		 * debug", este teste falha — que é exatamente o ponto.
		 */
		const { valor, ...guardado } = await gerarChave({ nome: 'teste', escopos: [ESCOPOS.LER] });

		expect(valor).toMatch(/^pgc_/);
		expect(JSON.stringify(guardado)).not.toContain(valor);
	});

	it('gera chaves diferentes a cada chamada', async ()=>{
		const a = await gerarChave({ nome: 'a', escopos: [] });
		const b = await gerarChave({ nome: 'b', escopos: [] });

		expect(a.valor).not.toBe(b.valor);
	});

	it('produz o mesmo hash para o mesmo valor, para o login funcionar', ()=>{
		expect(calcularHash('pgc_abc')).toBe(calcularHash('pgc_abc'));
		expect(calcularHash('pgc_abc')).not.toBe(calcularHash('pgc_abd'));
	});
});

describe('autenticação', ()=>{
	it('recusa sem header e diz qual header enviar', async ()=>{
		// Erro que não diz o que fazer obriga a IA a adivinhar.
		const resposta = await request(fazApp()).get('/protegida').expect(401);

		expect(resposta.body.erro.codigo).toBe('chave_ausente');
		expect(resposta.body.erro.acao).toMatch(/X-Pugicordium-Key/);
	});

	it('recusa chave desconhecida', async ()=>{
		const resposta = await request(fazApp())
			.get('/protegida')
			.set('X-Pugicordium-Key', 'pgc_naoexiste')
			.expect(401);

		expect(resposta.body.erro.codigo).toBe('chave_invalida');
	});

	it('aceita chave válida', async ()=>{
		registraChave({ valor: 'pgc_boa', escopos: [ESCOPOS.LER] });

		const resposta = await request(fazApp())
			.get('/protegida')
			.set('X-Pugicordium-Key', 'pgc_boa')
			.expect(200);

		expect(resposta.body.ok).toBe(true);
	});
});

describe('isolamento dos dois modelos de autenticação', ()=>{
	it('não popula req.account ao autenticar por chave', async ()=>{
		/*
		 * server/app.js decodifica o cookie nc_session e monta req.account
		 * para TODO request. Se a chave também escrevesse ali, os dois
		 * modelos — que precisam conviver — ficariam acoplados, e uma mudança
		 * no login do NaturalCrit passaria a afetar a API de máquina.
		 *
		 * A chave vive em req.chavePugicordium, e só lá.
		 */
		registraChave({ valor: 'pgc_boa', escopos: [ESCOPOS.LER] });

		const resposta = await request(fazApp())
			.get('/protegida')
			.set('X-Pugicordium-Key', 'pgc_boa')
			.expect(200);

		expect(resposta.body.temChave).toBe(true);
		expect(resposta.body.temAccount).toBe(false);
	});
});

describe('escopos', ()=>{
	it('recusa quando falta o escopo da rota e diz qual falta', async ()=>{
		registraChave({ valor: 'pgc_soleitura', escopos: [ESCOPOS.LER] });

		const resposta = await request(fazApp(ESCOPOS.ESCREVER))
			.get('/protegida')
			.set('X-Pugicordium-Key', 'pgc_soleitura')
			.expect(403);

		expect(resposta.body.erro.codigo).toBe('chave_sem_escopo');
		expect(resposta.body.erro.mensagem).toContain(ESCOPOS.ESCREVER);
	});

	it('não deixa escopo de uma rota valer para outra', async ()=>{
		/*
		 * Escopo é conferido por rota, não uma vez no login. Uma chave com
		 * escrita não deve poder medir só porque já passou pela autenticação
		 * — senão o escopo vira decoração.
		 */
		registraChave({ valor: 'pgc_escrita', escopos: [ESCOPOS.ESCREVER] });

		await request(fazApp(ESCOPOS.MEDIR))
			.get('/protegida')
			.set('X-Pugicordium-Key', 'pgc_escrita')
			.expect(403);
	});

	it('aceita quando a chave tem o escopo pedido entre vários', async ()=>{
		registraChave({ valor: 'pgc_completa', escopos: Object.values(ESCOPOS) });

		await request(fazApp(ESCOPOS.MEDIR))
			.get('/protegida')
			.set('X-Pugicordium-Key', 'pgc_completa')
			.expect(200);
	});
});
