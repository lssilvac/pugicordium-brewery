/*
 * Medição de paginação, no servidor, sem navegador.
 *
 * ===================== POR QUE NÃO TEM CHROMIUM AQUI =====================
 *
 * A proposta original era Playwright contra o próprio renderer. Não
 * funcionaria, por duas razões verificadas no código:
 *
 * 1. brewRenderer.jsx:164-181 VIRTUALIZA as páginas — só ±3 em torno da
 *    posição de scroll são renderizadas de verdade; as outras são um <div>
 *    com um spinner. Um Playwright mediria altura de página-fantasma e
 *    devolveria números que parecem válidos e estão errados. Isso é pior que
 *    não medir: um número errado que parece certo não é conferido.
 *
 * 2. O print real é window.frames['BrewRenderer'].contentWindow.print(). O
 *    page.pdf() do Playwright pagina o documento de cima; conteúdo de iframe
 *    é recortado na caixa, não paginado.
 *
 * E o custo ignorava o que dói: CPU, ausência de fila, /dev/shm de 64 MB,
 * --no-sandbox executando CSS vindo do campo `style` do brew, e o fato de a
 * VPS ser a mesma da produção de um cliente. Um Chromium saturando CPU
 * derruba o healthcheck do próprio brewery e faz o Coolify reverter no meio
 * do render.
 *
 * O que ESTE módulo entrega é a parte determinística: quantas páginas, onde
 * cada uma quebra, e o que há em cada uma. Isso responde a tarefa aberta do
 * ESTADO.md — "conferir a paginação real do brew" — sem browser nenhum.
 *
 * O que ele NÃO entrega, e diz claramente: estouro em pixels. Altura de
 * página depende do tema, da fonte e do CSS do documento. Sem renderizar,
 * qualquer número em pixels seria chute. O campo `densidade` é uma
 * estimativa marcada como tal, para priorizar o que conferir a olho — não
 * para decidir sozinho.
 *
 * ============================ SINCRONIA ============================
 *
 * As regexes abaixo são cópia literal de brewRenderer.jsx:23-25. Cópia
 * porque o renderer é .jsx de cliente e não se importa no servidor. Existe
 * um teste que falha se elas divergirem — ver tests/pugicordium/paginacao.test.js.
 */

// Cópia literal de client/homebrew/brewRenderer/brewRenderer.jsx:23-25
export const PAGEBREAK_REGEX_V3     = /^(?=\\page(?:break)?(?: *{[^\n{}]*})?$)/m;
export const PAGEBREAK_REGEX_LEGACY = /\\page(?:break)?/m;
export const COLUMNBREAK_REGEX      = /\\column(:?break)?/m;

/*
 * Para CONTAR colunas usamos uma versão global e sem grupo.
 *
 * A regex do upstream tem `(:?break)?` — dois-pontos-interrogação dentro do
 * parêntese, não `(?:break)?`. É um grupo CAPTURANTE que casa ":?break", não
 * um grupo não-capturante. No upstream isso é inofensivo, porque lá ela só
 * aparece em `.replace()` (brewRenderer.jsx:200).
 *
 * Em `.split()`, porém, um grupo capturante injeta o que capturou no array
 * de saída — e a contagem sai inflada. Um teste pegou isso: 'a\\column\\b'
 * devolvia 3 pedaços em vez de 2.
 *
 * Não "corrigimos" a regex acima de propósito: ela é cópia literal e existe
 * um teste garantindo que continue idêntica à do renderer. Para contar,
 * usamos esta, que é derivada e declaradamente nossa.
 */
const CONTAGEM_DE_COLUNAS = /\\column(?:break)?/gm;

/*
 * Referência de densidade.
 *
 * ~2.600 caracteres numa página de duas colunas do tema 5ePHB em corpo
 * padrão. É ordem de grandeza, obtida contando o material existente — não
 * uma medida do renderizador. Serve para ordenar páginas por risco, não
 * para afirmar que uma estourou.
 */
const CARACTERES_POR_PAGINA_CHEIA = 2600;

function primeiraLinhaUtil(texto) {
	const linhas = texto.split('\n');

	for (const linha of linhas) {
		const limpa = linha.trim();

		if(!limpa) continue;
		if(limpa.startsWith('\\page')) continue;

		return limpa.slice(0, 120);
	}

	return '';
}

function ultimaLinhaUtil(texto) {
	const linhas = texto.split('\n');

	for (let i = linhas.length - 1; i >= 0; i--) {
		const limpa = linhas[i].trim();

		if(!limpa) continue;

		return limpa.slice(0, 120);
	}

	return '';
}

/**
 * Mede a paginação de um markdown de brew.
 *
 * @param {string} texto     markdown cru
 * @param {string} renderer  'V3' (padrão) ou 'legacy'
 */
export function medirPaginacao(texto, renderer = 'V3') {
	const regex = renderer === 'legacy' ? PAGEBREAK_REGEX_LEGACY : PAGEBREAK_REGEX_V3;
	const brutas = String(texto ?? '').split(regex);

	const paginas = brutas.map((conteudo, i)=>{
		const caracteres = conteudo.length;
		const proporcao  = caracteres / CARACTERES_POR_PAGINA_CHEIA;

		return {
			pagina        : i + 1,
			caracteres,
			linhas        : conteudo.split('\n').length,
			colunas       : (conteudo.match(CONTAGEM_DE_COLUNAS) ?? []).length + 1,
			comeca        : primeiraLinhaUtil(conteudo),
			termina       : ultimaLinhaUtil(conteudo),
			// estimativa, não medição — ver o cabeçalho deste arquivo
			densidade     : Number(proporcao.toFixed(2)),
			risco         : proporcao > 1.15 ? 'provavel_estouro'
			              : proporcao > 0.95 ? 'no_limite'
			              : proporcao < 0.25 ? 'quase_vazia'
			              : 'ok',
		};
	});

	return {
		paginas   : paginas.length,
		renderer,
		detalhe   : paginas,
		aviso     : 'densidade e risco são estimativas por contagem de caracteres, '
		          + 'não medição de altura renderizada. Altura real depende do tema, '
		          + 'da fonte e do CSS do documento.',
	};
}
