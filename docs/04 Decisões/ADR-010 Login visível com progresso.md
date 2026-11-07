# ADR-010 Login visível com progresso

Data: 2026-10-28. Status: aceita.

O usuário substituiu a ocultação durante autenticação por Riot visível com carregamento. No modo sobreposto, o serviço reutiliza o backend e troca de conta por logout local antes da primeira submissão. Não reinicia o cliente para injetar um YAML salvo. Reaproveita uma conta já autorizada somente após conferir identidade. Mantém o fluxo privado anterior como compatibilidade.

A sobreposição apresenta progresso e cancelamento durante a operação; verificação humana recolhe o progresso ao canto para liberar a tela nativa. Após processo e janela do jogo confirmados, envia fechamento somente às janelas da interface Riot, sem encerrar serviços nem jogos. Erro ou cancelamento conserva o cliente visível. A sessão recém-criada continua sendo guardada pelo serviço.

Revisada em 2026-11-06 por [[ADR-024 Coluna de login coberta durante o login]]: durante o login visível, a coluna de login fica coberta por um carregamento, e qualquer verificação humana da Riot a descobre.

Revisada em 2026-11-06 por [[ADR-019 Sessão salva por conta no modo cartões]]: com sessão guardada e "Manter login" ligado, o modo sobreposto reinicia os serviços da Riot para restaurar a sessão em segundo plano. O login visível continua na primeira entrada de cada conta e quando a Riot recusa a sessão.
