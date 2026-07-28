/*
 * Erros legíveis por máquina.
 *
 * O PLANO.md pede "erro legível por máquina — código, campo, o que fazer".
 * A razão é concreta: quando uma IA recebe "500 Internal Server Error", a
 * única recuperação possível é tentar de novo igual. Quando recebe
 * `chave_sem_escopo` com a lista de escopos que faltam, ela corrige.
 *
 * Contrato:
 *   codigo    estável, snake_case, NUNCA muda — é o que a máquina lê
 *   campo     qual entrada causou, quando aplicável
 *   mensagem  para humano, em pt-BR
 *   acao      o próximo passo concreto
 *
 * `codigo` fazer parte do contrato significa que renomear um deles é
 * quebra de versão, e por isso a API é /api/v1/.
 */

export const CODIGOS = {
	CHAVE_AUSENTE       : 'chave_ausente',
	CHAVE_INVALIDA      : 'chave_invalida',
	CHAVE_SEM_ESCOPO    : 'chave_sem_escopo',
	BREW_NAO_ENCONTRADO : 'brew_nao_encontrado',
	CAMPO_INVALIDO      : 'campo_invalido',
	CORPO_INVALIDO      : 'corpo_invalido',
	CONFLITO            : 'conflito',
	INTERNO             : 'erro_interno',
};

/**
 * Monta o corpo do erro. Sempre o mesmo formato, para o cliente poder
 * confiar na forma sem inspecionar o status.
 */
export function corpoErro({ codigo, mensagem, acao, campo = null }) {
	return {
		erro : {
			codigo,
			campo,
			mensagem,
			acao,
		},
	};
}

export function responderErro(res, status, dados) {
	return res.status(status).json(corpoErro(dados));
}

/* Atalhos para os erros repetidos, para a mensagem não divergir entre rotas. */

export const erros = {
	chaveAusente : (res)=>responderErro(res, 401, {
		codigo   : CODIGOS.CHAVE_AUSENTE,
		mensagem : 'Nenhuma chave de API foi enviada.',
		acao     : 'Envie o header X-Pugicordium-Key.',
	}),

	chaveInvalida : (res)=>responderErro(res, 401, {
		codigo   : CODIGOS.CHAVE_INVALIDA,
		mensagem : 'A chave enviada não existe ou foi revogada.',
		acao     : 'Confira a chave, ou gere outra com `npm run pugicordium:chave`.',
	}),

	semEscopo : (res, escopoNecessario)=>responderErro(res, 403, {
		codigo   : CODIGOS.CHAVE_SEM_ESCOPO,
		campo    : 'escopos',
		mensagem : `A chave não tem o escopo "${escopoNecessario}".`,
		acao     : `Gere uma chave que inclua "${escopoNecessario}".`,
	}),

	brewNaoEncontrado : (res, id)=>responderErro(res, 404, {
		codigo   : CODIGOS.BREW_NAO_ENCONTRADO,
		campo    : 'id',
		mensagem : `Nenhum brew com o id "${id}".`,
		acao     : 'Confira o id com brew_listar. Aceita shareId ou editId.',
	}),

	campoInvalido : (res, campo, motivo)=>responderErro(res, 422, {
		codigo   : CODIGOS.CAMPO_INVALIDO,
		campo,
		mensagem : `O campo "${campo}" é inválido: ${motivo}`,
		acao     : 'Corrija o campo e repita. Use dryRun=true para ensaiar.',
	}),

	interno : (res, detalhe)=>responderErro(res, 500, {
		codigo   : CODIGOS.INTERNO,
		mensagem : 'Erro interno ao processar o pedido.',
		acao     : detalhe ? `Detalhe: ${detalhe}` : 'Tente novamente; se persistir, veja os logs do container.',
	}),
};
