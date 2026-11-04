# ADR-010 Login visível com progresso

Data: 2026-10-28. Status: aceita.

O usuário substituiu a ocultação durante autenticação por Riot visível com carregamento. No modo sobreposto, o serviço reutiliza o backend e troca de conta por logout local antes da primeira submissão. Não reinicia o cliente para injetar um YAML salvo. Reaproveita uma conta já autorizada somente após conferir identidade. Mantém o fluxo privado anterior como compatibilidade.

A sobreposição apresenta progresso e cancelamento durante a operação; verificação humana recolhe o progresso ao canto para liberar a tela nativa. Após processo e janela do jogo confirmados, envia fechamento somente às janelas da interface Riot, sem encerrar serviços nem jogos. Erro ou cancelamento conserva o cliente visível. A sessão recém-criada continua sendo guardada pelo serviço.
