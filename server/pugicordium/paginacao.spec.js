/*
 * Testes da medição de paginação.
 *
 * Padrão herdado do repo `carisma`: o teste codifica POR QUE a regra existe,
 * não só o que o código faz. Um teste que não consegue falhar quando a regra
 * de negócio muda está errado.
 *
 * Unit puro: nada aqui toca banco, rede ou sistema de arquivos.
 */

import fs   from 'fs';
import path from 'path';

import {
	medirPaginacao,
	PAGEBREAK_REGEX_V3,
	PAGEBREAK_REGEX_LEGACY,
} from './paginacao.js';

/** Constrói um markdown de brew com N páginas e conteúdo controlado. */
function fazBrew({ paginas = 1, corpoPorPagina = 'Texto da página.' } = {}) {
	const blocos = [];

	for (let i = 0; i < paginas; i++) {
		if(i > 0) blocos.push('\\page');

		blocos.push(`# Página ${i + 1}`);
		blocos.push(corpoPorPagina);
	}

	return blocos.join('\n');
}

describe('sincronia com o brewRenderer', ()=>{
	/*
	 * Este é o teste mais importante do arquivo.
	 *
	 * As regexes daqui são CÓPIA de client/homebrew/brewRenderer/brewRenderer.jsx,
	 * porque o renderer é .jsx de cliente e não se importa no servidor. Cópia
	 * significa que um merge do upstream pode mudar lá e não aqui — e a
	 * medição passaria a discordar do que o usuário vê na tela, silenciosamente.
	 *
	 * Um número de páginas errado que parece certo é pior que erro nenhum:
	 * ninguém confere o que parece certo.
	 */
	const arquivoDoRenderer = path.resolve(
		process.cwd(),
		'client/homebrew/brewRenderer/brewRenderer.jsx',
	);

	it('mantém a regex de quebra de página V3 idêntica à do renderer', ()=>{
		const fonte = fs.readFileSync(arquivoDoRenderer, 'utf-8');
		const achado = fonte.match(/const PAGEBREAK_REGEX_V3\s*=\s*(\/.*\/[a-z]*);/);

		expect(achado).not.toBeNull();
		expect(achado[1]).toBe(PAGEBREAK_REGEX_V3.toString());
	});

	it('mantém a regex de quebra de página legacy idêntica à do renderer', ()=>{
		const fonte = fs.readFileSync(arquivoDoRenderer, 'utf-8');
		const achado = fonte.match(/const PAGEBREAK_REGEX_LEGACY\s*=\s*(\/.*\/[a-z]*);/);

		expect(achado).not.toBeNull();
		expect(achado[1]).toBe(PAGEBREAK_REGEX_LEGACY.toString());
	});
});

describe('contagem de páginas', ()=>{
	it('conta uma página quando não há nenhuma quebra', ()=>{
		const resultado = medirPaginacao(fazBrew({ paginas: 1 }));

		expect(resultado.paginas).toBe(1);
		expect(resultado.detalhe).toHaveLength(1);
	});

	it('conta uma página a mais para cada \\page', ()=>{
		expect(medirPaginacao(fazBrew({ paginas: 3 })).paginas).toBe(3);
		expect(medirPaginacao(fazBrew({ paginas: 7 })).paginas).toBe(7);
	});

	it('trata texto vazio como uma página, não como zero', ()=>{
		// Um brew em branco tem uma página em branco no renderer. Devolver 0
		// faria a IA achar que o documento não existe.
		expect(medirPaginacao('').paginas).toBe(1);
		expect(medirPaginacao(null).paginas).toBe(1);
		expect(medirPaginacao(undefined).paginas).toBe(1);
	});

	it('reconhece \\pagebreak como sinônimo de \\page', ()=>{
		// O renderer aceita os dois; a medição tem de aceitar também, senão
		// diverge do que o usuário vê.
		const texto = '# Um\n\\pagebreak\n# Dois';

		expect(medirPaginacao(texto).paginas).toBe(2);
	});

	it('só quebra quando \\page está sozinho na linha, no renderer V3', ()=>{
		/*
		 * A regex V3 usa âncoras de linha. Uma menção a "\page" no meio de um
		 * parágrafo — explicando a sintaxe, por exemplo — NÃO é quebra. Sem
		 * isso, qualquer documentação sobre o Homebrewery escrita dentro do
		 * próprio Homebrewery se estilhaçaria em páginas.
		 */
		const texto = 'Use o comando \\page para quebrar a página.';

		expect(medirPaginacao(texto, 'V3').paginas).toBe(1);
	});

	it('no renderer legacy, quebra mesmo no meio da linha', ()=>{
		// Comportamento diferente e proposital do upstream: a regex legacy não
		// tem âncora. Documentado aqui para que a diferença seja intencional
		// e não uma surpresa.
		const texto = 'Use o comando \\page para quebrar.';

		expect(medirPaginacao(texto, 'legacy').paginas).toBe(2);
	});
});

describe('detalhe por página', ()=>{
	it('reporta onde cada página começa e termina', ()=>{
		/*
		 * É o dado que fecha o loop de escrita descrito no PLANO.md: a IA
		 * escreve, mede, vê que a página 2 termina no meio de uma frase, corta
		 * e remede. Sem "termina", só saber o número de páginas não ajuda.
		 */
		const texto = '# Abertura\nA Torre escurece.\n\\page\n# Travessia\nO orvalho cai.';
		const { detalhe } = medirPaginacao(texto);

		expect(detalhe[0].comeca).toBe('# Abertura');
		expect(detalhe[0].termina).toBe('A Torre escurece.');
		expect(detalhe[1].comeca).toBe('# Travessia');
		expect(detalhe[1].termina).toBe('O orvalho cai.');
	});

	it('ignora a própria linha \\page ao dizer onde a página começa', ()=>{
		// A quebra V3 fica no início do bloco seguinte. Reportá-la como
		// "começa" não diria nada ao autor.
		const { detalhe } = medirPaginacao('# Um\n\\page\n# Dois');

		expect(detalhe[1].comeca).toBe('# Dois');
	});

	it('conta as colunas criadas por \\column', ()=>{
		const { detalhe } = medirPaginacao('Esquerda\n\\column\nDireita');

		expect(detalhe[0].colunas).toBe(2);
	});

	it('numera as páginas a partir de 1, como o autor as enxerga', ()=>{
		const { detalhe } = medirPaginacao(fazBrew({ paginas: 3 }));

		expect(detalhe.map((p)=>p.pagina)).toEqual([1, 2, 3]);
	});
});

describe('estimativa de risco', ()=>{
	/*
	 * `densidade` e `risco` são ESTIMATIVA por contagem de caracteres, não
	 * medição de altura. Altura real depende do tema, da fonte e do CSS do
	 * documento — sem renderizar, qualquer número em pixels seria chute.
	 *
	 * Os testes abaixo fixam o contrato de que isso é uma triagem para o
	 * humano priorizar o que conferir, e que a resposta ADMITE a limitação.
	 */
	it('marca como quase vazia uma página com pouco texto', ()=>{
		const { detalhe } = medirPaginacao('Só isto.');

		expect(detalhe[0].risco).toBe('quase_vazia');
	});

	it('marca como provável estouro uma página muito acima da referência', ()=>{
		const { detalhe } = medirPaginacao('x'.repeat(4000));

		expect(detalhe[0].risco).toBe('provavel_estouro');
	});

	it('sempre devolve o aviso de que risco é estimativa, não medição', ()=>{
		// Se este teste falhar porque alguém tirou o aviso, o problema não é
		// o teste: a resposta passaria a afirmar precisão que não tem.
		const resultado = medirPaginacao('qualquer coisa');

		expect(resultado.aviso).toMatch(/estimativa/i);
		expect(resultado.aviso).toMatch(/não medição/i);
	});
});
