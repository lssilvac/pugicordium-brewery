/*
 * Fechamento da instância privada.
 *
 * O Vault do Homebrewery é uma vitrine: GET /api/vault?count=100 lista
 * título, descrição, autores e tags de todo brew publicado, SEM
 * autenticação. Faz sentido numa instância pública com milhares de brews;
 * aqui é o background de uma personagem numa máquina na internet aberta.
 *
 * Esconder o item de menu por CSS não fecha o endpoint — foi o que a
 * primeira versão da skin fazia, e o dado continuava servido a quem pedisse
 * a URL. O fechamento é aqui.
 *
 * Devolve 404, não 403: 403 confirma que existe algo ali. 404 não conta nada
 * a quem estava sondando.
 *
 * Desligável por env, para quem quiser rodar uma instância pública a partir
 * deste fork: PUGICORDIUM_PRIVADO=false.
 */

const ROTAS_FECHADAS = [
	/^\/api\/vault/,
	/^\/vault/,
	/^\/admin/,
];

export function privacidade(req, res, next) {
	// nconf lê env em minúsculas; aqui basta process.env porque é leitura direta
	const privado = (process.env.PUGICORDIUM_PRIVADO ?? 'true') !== 'false';

	if(!privado) return next();

	const caminho = req.path;

	if(ROTAS_FECHADAS.some((r)=>r.test(caminho))) {
		// Content negotiation: quem pediu JSON recebe JSON.
		if(req.accepts(['html', 'json']) === 'json') {
			return res.status(404).json({
				erro : {
					codigo   : 'rota_indisponivel',
					campo    : null,
					mensagem : 'Esta rota não existe nesta instância.',
					acao     : 'Use /api/v1/ com uma chave de API.',
				},
			});
		}

		return res.status(404).send('Não encontrado.');
	}

	return next();
}
