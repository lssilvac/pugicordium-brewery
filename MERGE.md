# O que este fork toca no upstream

*Leia antes de `git merge upstream/master`.*

A regra do fork é **somar arquivos, nunca editar os do upstream**. Ela existe
para que atualizar do `naturalcrit/homebrewery` continue barato — o upstream
lança com frequência, e o valor do fork está em acompanhar essas versões.

A regra não é absoluta: alguns ganhos exigem um ponto de contato. Cada exceção
está listada abaixo, com o motivo e o que fazer se conflitar. **Se você
adicionar uma exceção, registre aqui na mesma edição.**

---

## Arquivos do upstream editados

### `client/homebrew/main.jsx` — 3 linhas

```jsx
// Pugicordium: única linha adicionada a um arquivo do upstream. Tudo o que o
// fork soma pendura em client/pugicordium/inicializar.js.
import '../pugicordium/inicializar.js';
```

**Por quê:** é o único ponto onde dá para injetar CSS e comportamento sem
tocar componente. O arquivo tem 8 linhas.

**Honestidade sobre o risco:** a primeira versão deste documento afirmava que
o arquivo "mudou 7 vezes em 3 anos". Errado. `git log --diff-filter=A` mostra
que ele **nasceu em 01/02/2026**, na migração para o Vite — são 7 commits em 6
meses, ~1,2/mês, e as mensagens ("trying to get this to work", "not quite
working") são de arquivo ainda assentando. Em *taxa*, ele muda mais que o
`homebrew.jsx`.

O argumento que se sustenta é outro, e basta: **o arquivo tem 8 linhas, e
qualquer conflito nele se resolve à mão em segundos.**

**Se conflitar:** mantenha o import como último do bloco e siga.

### `robots.txt` — arquivo inteiro

**Por quê:** a instância é privada e está na internet aberta. O upstream
libera tudo menos `/edit/`.

**Risco:** o menor do repositório — 3 commits em 10 anos.

**Se conflitar:** mantenha `Disallow: /`.

---

## Arquivos NOVOS (não conflitam nunca)

| Caminho | Papel |
|---|---|
| `Dockerfile.pugicordium` | imagem de produção; `NODE_ENV=production` fecha o `/local/login` |
| `config/production.json` | `host` e `publicUrl` |
| `client/pugicordium/inicializar.js` | ponto de entrada do fork |
| `client/pugicordium/skin.less` | identidade visual |
| `client/pugicordium/tokens.less` | design tokens |
| `MERGE.md` | este arquivo |

---

## Dívidas que o merge pode reabrir

Estas não quebram o build — degradam em silêncio, que é pior. **Confira depois
de todo merge.**

### 1. Seletores da skin

`skin.less` reveste seletores do upstream. Se a marcação mudar, a regra deixa
de casar e nada avisa.

Verificação: abrir a instância e conferir que `.homebrew nav` tem fundo
`#1a1a28` e borda de latão. Já aconteceu uma vez: a primeira versão usava
`.navbar`, seletor que `navbar.less` declara mas que o componente **não
aplica** — a barra é um `<nav>` sem classe.

### 2. `outline: none` novos

O upstream zera outline em 6 lugares hoje, um deles com `!important`. A skin
tem um bloco de exceções que os anula um a um.

Verificação:

```bash
grep -rn "outline\s*:\s*none" --include=*.less client/ themes/ shared/
```

Se o número passar de 6, há foco invisível novo — acrescente a exceção.

### 3. Ordem de cascata

O Vite emite CSS na ordem do grafo de imports. A skin ganha os empates porque
é importada **depois** de `homebrew.jsx`. Um merge que reordene os imports do
`main.jsx` desliga parte da skin sem erro nenhum.

Mitigação: as regras que sobrescrevem o upstream usam dobra de classe
(`.homebrew.homebrew`) ou `!important` declarado. Onde não usarem, dependem da
ordem — e essa é a fragilidade conhecida.

### 4. Chave do tema do editor

`inicializar.js` grava `HB_editor_theme` no localStorage. A chave é definida
em `client/homebrew/editor/editor.jsx:12`. Se o upstream renomear, o padrão
escuro para de valer silenciosamente.

### 5. Botão de salvar

O atalho `Ctrl+S` aciona `.navItem.save`. Se a classe mudar, o atalho vira
no-op — falha silenciosa e inofensiva, mas silenciosa.

---

## Depois de todo merge

```bash
git merge upstream/master
npm ci --ignore-scripts
node node_modules/vite/bin/vite.js build   # o shim do npm quebra em caminho com espaço
npm test
grep -rn "outline\s*:\s*none" --include=*.less client/ themes/ shared/ | wc -l   # esperado: 6
```

E abra a instância: navbar escura com borda de latão, editor com tema
`darkbrewery`, Patreon ausente.
