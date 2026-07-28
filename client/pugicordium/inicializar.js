/*
 * Inicialização do Pugicordium.
 *
 * Este módulo é o ÚNICO ponto de entrada do fork no código do upstream: o
 * main.jsx importa só este arquivo, e tudo o que somamos pendura aqui. Manter
 * uma linha só lá é o que faz `git merge upstream/master` continuar barato.
 *
 * Nada aqui edita componente. As três funções abaixo agem por fora: CSS,
 * localStorage e um listener de teclado.
 */

import './skin.less';

/*
 * O editor de código tem tema escuro nativo — themes/codeMirror/darkbrewery.js,
 * já no repositório. O padrão do upstream é o claro.
 *
 * Isto NÃO é firulaesque: o editor ocupa ~440.000 px² da tela, e é a maior
 * superfície da interface. Deixá-lo branco dentro de uma casca de vácuo seria
 * o pior dos dois mundos — o contraste entre painéis cansa mais que qualquer
 * um dos dois temas sozinho.
 *
 * Forçar as cores por CSS seria errado: o destaque de sintaxe do CodeMirror é
 * calibrado para o fundo do tema, e escurecer só o fundo deixaria o texto
 * ilegível. Trocar o tema resolve pela raiz.
 *
 * A escolha do usuário ganha: só grava se a chave nunca foi definida. Quem
 * trocar para 'default' pelo menu continua no claro para sempre.
 */
const CHAVE_TEMA_EDITOR = 'HB_editor_theme'; // definida em client/homebrew/editor/editor.jsx
const TEMA_PADRAO = 'darkbrewery';

function definirTemaEscuroDoEditor() {
	try {
		if(window.localStorage.getItem(CHAVE_TEMA_EDITOR) === null) {
			window.localStorage.setItem(CHAVE_TEMA_EDITOR, TEMA_PADRAO);
		}
	} catch (e) {
		// localStorage pode estar bloqueado (modo privado, cookies negados).
		// Perder a preferência de tema não justifica derrubar o boot.
	}
}

/*
 * Ctrl+S / Cmd+S salva.
 *
 * É o gesto automático de quem escreve, e hoje ele abre o "salvar página" do
 * navegador — que é pior que não fazer nada, porque o autor acha que salvou.
 *
 * Aciona o botão de salvar existente em vez de chamar a API por fora: assim a
 * lógica de salvamento continua sendo a do upstream (validação, estado,
 * tratamento de erro), e não há um segundo caminho de escrita para manter em
 * sincronia. Se o botão sumir numa versão futura, o atalho vira no-op — falha
 * silenciosa e inofensiva, não exceção.
 */
function ligarAtalhoDeSalvar() {
	window.addEventListener('keydown', (evento)=>{
		const ehSalvar = (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 's';

		if(!ehSalvar) return;

		const botao = document.querySelector('.navItem.save');

		if(!botao) return; // páginas sem editor: deixa o navegador seguir

		evento.preventDefault();

		if(botao.classList.contains('saved')) return; // nada mudou

		botao.click();
	});
}

definirTemaEscuroDoEditor();
ligarAtalhoDeSalvar();
