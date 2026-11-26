---
tipo: estudo
data: 2026-11-20
tags: [estudo, produto, login]
---

# Estudo - Gerenciadores no GitHub

Pedido do usuário em 2026-11-20: procurar no GitHub gerenciadores de contas da Riot, ativos e abandonados, para achar o que falta no Eclipse ("quero que o Eclipse vire referência") e ver como eles lidam com a verificação por e-mail ou aplicativo da Riot.

Busca pela API pública do GitHub ("riot/league/valorant account manager/switcher" e parecidos), 87 repositórios, 35 READMEs lidos. Só a documentação foi lida; nenhum código foi baixado nem executado. As estrelas e datas são de 2026-11-20.

## Conclusão

- Ninguém resolve a verificação da Riot de forma legítima e automática. Há quatro caminhos, e o Eclipse já usa os dois seguros juntos (formulário com 2FA na janela da Riot e sessão salva por conta, criptografada).
- O que separa os projetos mais completos do Eclipse não é o login, e sim o que eles mostram e fazem com a conta: estado da conta, ferramentas do dia a dia e presença pública (README, releases, traduções). Boa parte já está nos blocos 2 a 4 do [[Backlog]].

## Como lidam com a verificação

| Caminho | Quem | Verificação | Situação |
|---|---|---|---|
| Digitar no formulário da Riot (automação de interface ou API local) | Eadroma/RiotAccountManager, KratosCube/RiotAutoLogin, dancer/nidalee, Tariolle/LeagueAccounts, MouseWerk/lost-league-manager, JirkaachS/Riot-Relay, jduust/LeagueLogin | 2FA e CAPTCHA ficam na janela da Riot para a pessoa ("OTP and 2FA challenges stay manual", Riot Relay) | Ativo. É o modelo do [[ADR-003 Sem contornar CAPTCHA ou 2FA]] |
| Trocar o `RiotGamesPrivateSettings.yaml` (sessão do "Manter login") | TCNOco/TcNo-Acc-Switcher (2404★), klNuno/accshift, giovaniohira/alt-hop, arthiee4/RiotSwitcher, Pancake787/LoL-Account-Switcher, clitic/valtools, bahaaalden2200-design/riot-fast-login | O 2FA é feito uma vez; depois a sessão lembrada entra sozinha até expirar (troca de senha, "sair de todos os dispositivos", inatividade). Aí pedem "recapturar". riot-fast-login chama isso de "bypass 2FA", mas é só a sessão lembrada | Ativo. Vários guardam o arquivo em texto puro (alt-hop, Pancake787), e ele vale como senha. O Eclipse faz o mesmo com o cofre criptografado ([[ADR-019 Sessão salva por conta no modo cartões]]) |
| Autenticar direto na Riot, sem o cliente | karimawi/Guava | Quebrou quando a Riot pôs CAPTCHA no login, em agosto de 2023. O autor arquivou: a saída seria pagar serviço de resolver CAPTCHA | Morto |
| Ler o código do e-mail | fulmiiiiine/Smurf-Valorant-Manager | Lê o Gmail por IMAP com senha de app e manda o código ao Discord | Fora para o Eclipse: entrega o e-mail a um bot e vai contra o espírito do [[ADR-003 Sem contornar CAPTCHA ou 2FA]] |

## O que outros têm e o Eclipse não

Itens fora dos blocos 2 a 4 do [[Backlog]] estão marcados com **novo**.

- **Estado da segurança da conta (novo).** FlayInAHook/shunpo mostra se a conta tem telefone verificado; alt-hop mostra se o login usou 2FA, lido do token da sessão. O Eclipse já lê o `id_token` da sessão ([[sessionKeeper]]); dá para avisar "sem 2FA" ou "e-mail não verificado" por conta. Os campos exatos (`amr`, `email_verified`, `phone_number_verified`) precisam ser conferidos numa resposta real.
- **Saber antes se a entrada vai pedir verificação (novo).** alt-hop e Pancake787 marcam "sessão expirada" no cartão e oferecem recapturar. No Eclipse, um selo "entra direto" ou "vai pedir senha ou código" por conta, pelo estado da sessão salva.
- **Esconder da captura de tela e trancar o app (novo).** xi94/Pulsar esconde a janela de gravação e tranca sozinho; accshift tem PIN; Riot Relay e MouseWerk têm senha mestra opcional.
- **Ferramentas de conserto (novo).** MouseWerk: fechar todos os processos da Riot, reparar um cliente que não abre, limpar o cache do Riot Client. valtools: limpar o cache do VALORANT. Só com clique do usuário.
- **Adicionar colando o link do OP.GG (novo).** MouseWerk preenche Riot ID, servidor, elo e ícone a partir do link.
- **Aparecer offline (novo, grande).** Riot Relay e MouseWerk fazem um proxy do chat no estilo do Deceive. Exige ADR: mexe no tráfego do chat da Riot.
- **Verificar a conta exata depois de trocar (novo, pequeno).** Riot Relay só diz "trocou" depois de conferir o PUUID. O Eclipse confere o Riot ID e o `sub` da sessão; vale ver se cobre todos os caminhos.
- **Presença pública (novo).** TcNo traduz pela comunidade (Crowdin); accshift e Tariolle têm 6 ou 7 idiomas; Riot Relay publica capturas feitas com dados fictícios, SHA-256 dos instaladores e notas de versão. O Eclipse tem a prévia fictícia, que serve para as capturas do README.
- **Já no Backlog:** banimento e suspensão antes de jogar (Tariolle, MouseWerk), decaimento e restrição de ranqueada, histórico do elo e sessão de hoje (MouseWerk), loja diária e night market do VALORANT (valtools, noma-t/ValoAccounts), campeões e skins, carteira (VP, RP, Essência Azul), atalho global, bandeja, paleta Ctrl+K e `eclipse://` (KratosCube, accshift, TcNo), modo streamer (TcNo, accshift), copiar configurações entre contas (Riot Relay: no VALORANT pela nuvem do Riot Client, `Ares.PlayerSettings`, sem tocar em arquivos), atualização assinada (nidalee, Riot Relay).
- **Fora do foco de um gerenciador:** escolher campeão sozinho, aceitar fila, runas, rastrear feitiços do inimigo, sobreposição na partida (Ja-Sa-La/League-Account-Manager, KratosCube, kattitatu/riot-account-manager, MouseWerk).

## Abandonados e por quê

- karimawi/Guava (arquivado em 2023): CAPTCHA no login direto, acima.
- Charcadet/LoL-Account-Manager (arquivado em 2022): dependia de uma chave da API da Riot, que expira e precisava ser trocada várias vezes por semana. É o problema que o Eclipse evita com o OP.GG e a leitura do próprio jogo ([[ADR-037 Elo do League pelo OP.GG]], [[ADR-031 Elo lido do próprio jogo, sem chave]]).
- ynk/LolAccountManager (arquivado em 2023), RXJpaw/Valorant-Companion (arquivado em 2024), MarshallOfSound/valorant-account-switcher e JulioCardR/VAS (2021): parados sem explicação no README.

## Os mais próximos do Eclipse

- MouseWerk/lost-league-manager: o mais completo em informação da conta e ferramentas.
- JirkaachS/Riot-Relay: o mais cuidadoso em segurança e nos quatro jogos.
- Tariolle/LeagueAccounts: Rust, OP.GG e aviso de banimento.

## Tariolle/LeagueAccounts por dentro (2026-11-25)

Código lido em 2026-11-25, commit `60d87f6`, licença MIT.

- **Login por depurador.** A cada login ele fecha a árvore da Riot, sobe os serviços com `--headless` e abre o `Riot Client.exe` com os argumentos da Riot e mais `--remote-debugging-port`, dentro de um job do Windows que morre com o app. Pelo CDP, injeta um script que preenche os campos pelo `onChange` do React, envia com `requestSubmit()` e intercepta a resposta de `/rso-authenticator/v1/authentication/riot-identity/complete` para saber se foi sucesso, 2FA, CAPTCHA recusado, limite ou senha errada. O hCaptcha roda na janela real; 2FA e CAPTCHA ficam com a pessoa.
- **Por que o Eclipse não adota.** Reiniciar a Riot custa uns 10 s por login ([[Laboratório de velocidade do login]]), contra ~1 s do [[loginForm]]. A janela trocada quebra a sobreposição presa à janela oficial ([[ADR-012 Sobreposição presa à janela do Riot]]). A porta do depurador deixa qualquer programa local ler senha e token enquanto está aberta. O script depende de nomes internos do `renderer.js` da Riot (`getBinding`, `__reactProps$`). E rodar código dentro do cliente é mais invasivo perante a Riot.
- **O que vale trazer.** Região da Riot seguindo a conta (`PUT /riotclient/region-locale`, pelos `lol` e `lol_region` do userinfo); banimento antes do jogo (`ban.restrictions` do userinfo); porcentagem e tempo da atualização (`/patch-proxy/v2/patch-states/products/{produto}/patchlines/live`); manter o `--client-config-url` do Deceive ao reiniciar a Riot; e a lista de etapas do login na tela ([[ADR-053 Etapas do login na tela até o jogo abrir]]).
- **Saída de conta.** Ele troca de conta com `DELETE /player-session-lifecycle/v1/session`. Não foi medido se essa rota encerra a sessão no servidor; até medir, vale a [[ADR-020 Riot conectada é encerrada quando fica sem jogo]].
- xi94/Pulsar: os cinco jogos, incluindo 2XKO e Runeterra.

## Segunda busca (2026-11-25)

Pedido do usuário: procurar outros gerenciadores. Mesma busca pela API pública, com 20 termos (incluindo TFT, 2XKO e "auto login"), 142 repositórios; filtrados os já citados acima e ficaram os ativos desde junho de 2026 ou com 15 estrelas ou mais. Só os READMEs foram lidos (17); nenhum código foi baixado nem executado. Quase todos são de 2026, com 0 a 3 estrelas.

- **O padrão novo é trocar a pasta da sessão.** RiftSwitch (JustSad42), R-luiz/riot-account-switcher, VALAL (zaku-jd), Mise (codefecta), iMA-Switcher, derivia e trottyva guardam a sessão do "Manter login" por conta e trocam o arquivo ou a pasta `Data` do Riot Client. R-luiz guarda a pasta inteira, criptografada com DPAPI mais uma chave do Windows Hello, sem alternativa mais fraca. RiftSwitch copia de volta a sessão que a Riot reescreve enquanto está aberta, para ela não envelhecer.
- **"Não use Sair na Riot".** RiftSwitch, VALAL, Mise e iMA avisam que o Sair do Riot Client encerra a sessão no servidor e invalida a cópia salva. É mais um indício a favor da [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]; continua sem medição própria.
- **Não trocar em fila aceita, seleção de campeões ou partida.** RiftSwitch e R-luiz leem a fase do League pela API local e bloqueiam a troca, para não causar dodge.
- **Ideias que não estavam acima nem no [[Backlog]]:**
  - Perfis de configuração do League (`Config/PersistedSettings.json`) com trava de somente leitura para o jogo não sobrescrever (Jubstaaa/lol-config-editor, 8★; HaYToKoRaZ "CfgLock"; iMA aplica ao trocar).
  - "Qual conta jogar agora": sugere a conta mais perto de sofrer decaimento (MarvinPanVan/league-smurf-tracker).
  - Adicionar várias contas de uma vez colando uma lista de `Nome#TAG`, um link de multi-busca do OP.GG ou o texto do chat do saguão (mesmo projeto).
  - Busca com filtros escritos, como `>diamond is:stale region:euw` (mesmo projeto).
  - Notificação do Windows com resultado da partida e PdL, e aviso de decaimento (minibgg/lol-account-manager, Rust e egui).
  - Atalho na área de trabalho por conta (iMA-Switcher).
  - Senha copiada fora do histórico da área de transferência do Windows e apagada em 30 s (simonys32/LolAccountManager-v2, Rust e Tauri; RodrigoFass).
  - Posição no ranking regional para Imortal e Radiante no VALORANT (VALAL).
- **Fora do Eclipse:** fabbiodev/Riot-SDA faz login por QR e liga o autenticador do Riot Mobile, ou seja, age como o aplicativo de celular da Riot (mexe na segurança da conta). gassonexe/riot-autologger digita a senha por reconhecimento de imagem. valset e RodrigoFass fazem espionagem de partida ao vivo e botão de dodge. Mise organiza janelas. HaYToKoRaZ mexe na taxa de atualização do monitor.
- **Cuidado:** OstrichTruss/Riot-Account-Tool-Full-Version-Desktop foi criado em 2026-11-24, tem 11 estrelas em um dia e só um arquivo de licença, com o "download" na descrição. É o formato comum de isca com programa malicioso. Também apareceram geradores de contas e trocadores de senha em massa, que não são gerenciadores.
