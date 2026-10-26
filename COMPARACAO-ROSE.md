# Integração do gerenciador com o cliente Riot e o League

**Resultado implementado:** após a escolha da tela inicial do Riot Client, foi preparado um modo experimental com uma cópia privada da interface real, hospedada no Electron do projeto e conectada aos serviços locais oficiais. Há suporte aos pacotes 141.0.0 e 142.0.0; o painel com as contas salvas foi confirmado visualmente no formulário real v142.0.1, sem login/logout ou abertura de jogo. A instalação original fica intacta. Consulte [INTEGRACAO-RIOT.md](INTEGRACAO-RIOT.md) para usar e conhecer os limites. A comparação abaixo registra a análise que orientou a implementação.

## Conclusão

É viável desenvolver um seletor de contas dentro do lobby do League, seguindo a arquitetura de interface usada pelo Rose e reaproveitando o motor de login do gerenciador. Isso ainda não demonstra que o mesmo mecanismo pode ser colocado na tela inicial de login do Riot Client: são aplicativos diferentes.

A análise do Rose considerou o projeto público [Alban1911/Rose](https://github.com/Alban1911/Rose). Não foi localizada uma instalação ou cópia local do Rose nos diretórios inicialmente consultados. Essa comparação é estática e não envolveu a instalação do Rose/Pengu. Os experimentos posteriores no Riot estão descritos separadamente em [INTEGRACAO-RIOT.md](INTEGRACAO-RIOT.md); não houve autenticação de contas.

## Comparação

| Aspecto | Nosso gerenciador | Rose |
|---|---|---|
| Interface | Janela Electron própria | Plugins JavaScript na interface do League, além do programa externo |
| Função relevante | Contas, senhas criptografadas, sessões, login e abertura de produtos | Inclusão de botões e painéis no League e comunicação com um serviço externo |
| Onde executa o controle | Processo principal do gerenciador e auxiliares Windows | Serviço Python e plugins carregados com Pengu Loader |
| Comunicação interna | IPC Electron e API local do Riot Client | Ponte HTTP/WebSocket local entre o League e o serviço Python |
| Tela inicial de login Riot | Controlada externamente, sem modificar seu layout | Não foi encontrado um mecanismo pronto para modificar essa tela |
| Uso antes de abrir o League | Sim | A interface do plugin depende do cliente League existir |

As descrições do Rose acima são sustentadas pelo seu [README](https://github.com/Alban1911/Rose#architecture), pelo [painel de configurações](https://github.com/Alban1911/Rose/blob/main/Pengu%20Loader/plugins/ROSE-SettingsPanel/index.js) e pelo [servidor WebSocket](https://github.com/Alban1911/Rose/blob/main/pengu/core/websocket_server.py).

## O que o Rose demonstra

O painel `ROSE-SettingsPanel` usa elementos da interface League e manipulação do DOM para abrir seu conteúdo dentro do cliente. O `ROSE-SkinMonitor` disponibiliza uma ponte para o serviço externo; esse serviço segue executando separadamente. Portanto, uma experiência integrada visualmente não exige colocar o armazenamento e o motor de login dentro do processo do League.

O [core upstream do Pengu](https://github.com/PenguLoader/PenguLoader/blob/main/core/src/dllmain.cc#L48-L73) seleciona os processos `LeagueClientUx.exe` e `LeagueClientUxRender.exe`. A [documentação do próprio Pengu](https://github.com/PenguLoader/docs/blob/main/docs/guide/faqs.md) confirma seu foco na interface do League. Isso não é uma auditoria binária da versão vendorizada/distribuída pelo Rose, mas delimita o alcance da técnica documentada.

## Alternativa estudada: Contas dentro do League

1. Um plugin independente adiciona o botão **Contas** ao lobby do League.
2. O painel mostra Riot ID, elo, conta atual e disponibilidade de sessão salva. Não recebe senhas, chaves de API ou tokens Riot.
3. Ao escolher outra conta, o plugin envia apenas o identificador da conta e o produto desejado para o gerenciador.
4. O gerenciador aceita o pedido e devolve um identificador da operação antes de fechar o League. O painel do plugin desaparece durante essa troca.
5. O serviço do gerenciador continua executando, usa o fluxo de login atual, oculta o Riot Client e reabre o League na conta escolhida.
6. O plugin reaparece e reconecta para obter o resultado.

Essa arquitetura é uma proposta baseada nas fontes e no código existente. Ainda precisa de um protótipo e validação em uma instalação de teste.

### Alterações identificadas na análise inicial

O serviço compartilhado, a ponte autenticada e a execução na bandeja descritos abaixo já foram implementados para o painel na tela Riot. O plugin para o lobby do League não foi implementado, pois a tela escolhida pelo usuário foi a de login Riot.

- Extrair a execução do login atualmente concentrada no handler `sign-in` de `main.js` para um serviço compartilhado pela janela Electron e pela integração.
- Reaproveitar `src/signInFlow.js`, `src/riotClient.js`, `src/store.js` e o monitor Windows. A troca já fecha o League; o serviço precisa sobreviver ao encerramento da interface que iniciou a operação.
- Adicionar execução na bandeja. Atualmente fechar a janela principal também encerra o gerenciador.
- Criar ponte local autenticada, limitada a `127.0.0.1`, com pareamento, comandos restritos, validação de origem, limites de tamanho e controle de concorrência. O objeto `window.api` do preload Electron não existe dentro do League.
- Fazer a proteção contra troca durante partida no serviço, antes de fechar processos. Hoje a confirmação de encerramento fica na interface Electron; uma ponte não pode depender dela.
- Manter credenciais e sessões no armazenamento criptografado do gerenciador. Plugins que compartilham o mesmo contexto do League não formam uma fronteira de confiança entre si.
- Apresentar o andamento e permitir intervenção em 2FA/CAPTCHA também quando a janela principal do gerenciador estiver oculta.

Não é necessário incorporar o Rose inteiro nem seu sistema de skins. A parte útil para essa proposta é o padrão **plugin de interface + serviço local independente**.

## Se o objetivo for a tela de login do Riot Client

Na instalação local consultada, o Riot Client usa uma interface Electron separada, com `RiotClientElectron/resources/app.asar`. Seus metadados identificam o pacote como `riot-client-ux`, versão `141.0.0`. Esses dados foram lidos sem alterar ou executar o conteúdo do arquivo.

Isso mostra uma tecnologia próxima à do gerenciador, mas não cria uma interface de extensão compatível com Pengu. Alterar diretamente esse pacote, colocar o cliente dentro de outra janela ou construir uma interface externa que o controle são abordagens distintas; precisam ser avaliadas e testadas separadamente. Não se deve prometer uma fusão real com a tela oficial com base apenas no funcionamento do Rose no League.

Um launcher único pode reunir a seleção de contas e controlar os serviços Riot em segundo plano. Ele também cobre a primeira entrada, quando o League ainda não existe, e os produtos VALORANT/TFT. Essa opção oferece uma experiência unificada, mas continua sendo uma interface própria do gerenciador.

Independentemente da interface escolhida, 2FA/CAPTCHA continuam fazendo parte da autenticação. Mover botões ou mudar o layout não elimina essas etapas. A Riot também informa que a [League Client API não tem suporte oficial completo a terceiros nem garantia de estabilidade](https://developer.riotgames.com/docs/lol#league-client-api), o que torna a validação após atualizações parte da manutenção.
