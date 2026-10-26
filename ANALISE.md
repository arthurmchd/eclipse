# Análise do projeto

O projeto é um aplicativo Electron para Windows, com interface sem etapa de build, senhas e sessões criptografadas por DPAPI e consultas de elo separadas do login. A estrutura permite resolver o controle das janelas com recursos nativos do Windows, sem instalar bibliotecas adicionais.

## Melhorias implementadas

- **Monitor persistente:** substitui o monitor de três minutos e a ocultação de uma única janela. Reconhece `Riot Client`, `RiotClientUx`, `RiotClientUxRender` e `RiotClientServices`. Eventos de criação, exibição e foco são acompanhados com varredura de segurança. Os processos do jogo e do Vanguard ficam fora do filtro.
- **Abertura em etapas:** o monitor precisa confirmar que está pronto antes de iniciar o cliente. O jogo só é solicitado depois de verificar o Riot ID. O sucesso exige uma janela visível do jogo/lobby, e não apenas um processo iniciado.
- **Abertura direta:** a conta atual verificada é reaproveitada sem reinício. Um backend desconectado pode autenticar pelo serviço local sem criar outra janela. As trocas que precisam restaurar sessões iniciam somente os serviços com `--headless`; o jogo é solicitado após confirmar a conta. A gravação da sessão não atrasa esse pedido.
- **Intervenção controlada:** erros e demora não fazem a tela de login reaparecer automaticamente. 2FA, CAPTCHA e atualizações são informados no painel; o usuário pode abrir o cliente quando necessário. Após concluir a autenticação, ele volta ao segundo plano.
- **Cancelamento e recuperação:** Cancel interrompe a espera e o preenchimento da senha. O estado do botão Play e seus listeners são liberados mesmo se houver falha de comunicação. Settings oferece recuperação manual do cliente. Encerrar o painel restaura os estilos de janela alterados pelo monitor.
- **Sessões corretas:** os tokens atualizados da conta anterior são salvos antes de carregar a sessão escolhida. Uma sessão com identidade desconhecida não é associada automaticamente à conta anterior. Identidade diferente da selecionada impede continuar até o jogo.
- **Armazenamento:** caminhos de sessão são validados, as sessões são gravadas atomicamente e os backups passam a incluir edições de conta e configurações. Atualizações de elo não consomem a rotação de backups.
- **Falhas de execução:** erros ao iniciar o Riot Client, auxiliares Windows que não respondem e perda de resposta do monitor passam a ser tratados. Comandos do monitor são serializados para não competir entre si.
- **Contexto de login:** um `GET` com tipo `auth` não prova que o autenticador foi inicializado. O fluxo verifica a existência de contexto e executa a limpeza/inicialização antes de enviar a senha. Um CAPTCHA anterior à submissão usa a interface Riot escondida, sem duplicar tentativas. A recuperação manual abre a janela que contém a verificação pendente.
- **Interface de contas no login Riot:** modo experimental com uma cópia privada da interface real 141/142, conectada ao gerenciador por uma ponte local autenticada. Painel com contas salvas confirmado visualmente na tela de login v142.0.1, sem autenticar conta. A instalação Riot permanece original. O atalho também habilita a integração com o gerenciador normal já aberto. Detalhes em [INTEGRACAO-RIOT.md](INTEGRACAO-RIOT.md).
- **Serviço compartilhado:** o mesmo fluxo atende a janela do gerenciador e o seletor integrado. Operações concorrentes são recusadas; o painel integrado não inicia trocas com jogos abertos. O gerenciador continua na bandeja durante esse modo.

## Limites práticos

O fluxo foi validado com testes isolados e os auxiliares foram compilados no Windows. Não foi feita autenticação com contas reais nem abertura de uma partida durante essa validação. É necessário conferir o comportamento na versão instalada do Riot Client, inclusive com sessão nova, sessão expirada e 2FA.

O caminho principal usa os endpoints modernos do autenticador, conferidos na documentação local e no código da interface 142. O preenchimento de compatibilidade continua dependente do layout do Riot Client; um redesenho pode exigir ajustar `src/login.ps1`. A captura e os cliques desse fallback são direcionados à janela; o mouse e o teclado globais não são usados. A nova conexão e a leitura de estado foram conferidas no serviço real, sem submeter credenciais.

A API local usada para consultar a sessão e abrir produtos não é um contrato público estável. Não foi adicionada tentativa de contornar CAPTCHA ou 2FA. Se o cliente exigir intervenção, ela precisa ser concluída pelo usuário.

Eventos de janelas entre processos são assíncronos. O monitor reduz a aparição do Riot Client, mas não pode prometer zero flashes em todas as combinações de versão, renderização, permissões ou falha do monitor. O monitor precisa permanecer em execução; fechar o gerenciador encerra essa proteção e restaura as janelas.

Para LoL e TFT, o lobby do League é a janela inicial do jogo. Este gerenciador não entra automaticamente em filas nem inicia partidas.

## Próximas melhorias recomendadas

1. **Limites de tempo nas consultas de elo:** `getJson` em `src/riotApi.js` usa `fetch` sem prazo e compartilha uma fila. Uma conexão presa pode bloquear todas as atualizações. Acrescentar timeout e limitar esperas de rate limit evita travamento prolongado.
2. **Recuperação da atualização automática:** tratar rejeições nas chamadas agendadas de `refreshAll` e reagendar em `finally`. Uma chave impossível de descriptografar não deveria interromper todos os jogos nem parar o agendamento.
3. **Validação central das mensagens IPC:** validar formatos de conta, tipos de configurações e origem das chamadas. O renderer já tem isolamento de contexto e CSP; a validação do lado principal complementaria essas proteções.
4. **Distribuição e atualização:** criar um instalador assinado, com versionamento de dados e atualização controlada. Isso também deve incluir os dois auxiliares PowerShell fora de `app.asar` caso o aplicativo seja empacotado.
5. **Servidor de prévia:** limitar a escuta ao endereço local e reforçar validação de caminhos e URLs inválidas em `scripts/preview-server.js`. O servidor é uma ferramenta de desenvolvimento e não deve ser usado como hospedagem pública.

## Referências técnicas

- [Microsoft: SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook) — entrega assíncrona dos eventos e necessidade de processar a fila de mensagens.
- [Riot: documentação das APIs de cliente](https://developer.riotgames.com/docs/lol#league-client-api) — a Riot informa que os serviços locais de cliente documentados não têm garantia completa de documentação, disponibilidade ou aviso de mudanças. Isso reforça a necessidade de testar compatibilidade após atualizações; não constitui documentação dos endpoints privados usados aqui.
