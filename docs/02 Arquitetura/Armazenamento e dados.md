---
tipo: conceito
tags: [arquitetura, dados]
---

# Armazenamento e dados

Tudo do usuário fica em `%APPDATA%\riot-account-manager\`, fora da pasta do código. O dono desses arquivos é [[store]].

| Arquivo | Conteúdo | Protegido? |
|---|---|---|
| `data.json` | Contas, configurações, elos em cache, `currentAccountId`, `lastRefresh` | Senhas e chaves de API criptografadas por campo |
| `backups/` | Cópias de `data.json` a cada mudança de conta ou configuração; as 30 mais novas | Mesmo nível do `data.json` |
| `sessions/<id>.bin` | Cópia do `RiotGamesPrivateSettings.yaml` da conta, tirada com "manter conectado". Com "Manter login" desmarcado nas configurações, nenhuma cópia nova é gravada nem restaurada. Também é atualizada a cada nova gravação da Riot, e o login é tirado do arquivo da Riot assim que ela solta a conta. Sessões gravadas antes de 2026-11-06 13:00 UTC são apagadas quando o modo cartões inicia ([[sessionKeeper]], [[ADR-022 Sessões de antes do modo cartões são descartadas]]) | Arquivo inteiro criptografado |
| `data.log` | Eventos de gravação, para explicar uma conta perdida | Sem credenciais |
| `sign-in.log` | Passos de cada login; gira para `.old` acima de 200 KB | Sem usuário nem senha |

## Criptografia

Senhas, chaves de API e sessões usam `safeStorage` do Electron, que no Windows é o DPAPI: só o mesmo usuário Windows, na mesma máquina, consegue abrir. Copiar `data.json` para outro PC não leva as senhas. Ver [[ADR-002 Segredos protegidos pelo DPAPI]].

## Regras de gravação

- **Backups só para edições do usuário.** Inclusões, exclusões, edições de conta e mudanças de configuração geram backup. Atualização de elo e horário de abertura não, para não gastar a rotação.
- **Arquivo ilegível não é sobrescrito.** Se `data.json` sumir ou corromper, o app abre o backup mais novo e preserva o arquivo ruim.
- **Sessões com gravação atômica.** Uma substituição que falha deixa a sessão anterior utilizável e remove os temporários.
- **IDs de sessão validados.** Hoje são UUIDs; IDs antigos simples continuam aceitos. Separadores, pontos e sintaxe de caminho/stream do Windows são rejeitados antes de tocar o disco.
- **Sessão pertence a um login.** Trocar usuário ou senha de uma conta descarta a sessão salva dela.
- **Chave que não decripta não trava o app.** As contas carregam mesmo assim.
- **Opções antigas limpas ao carregar.** `minimizeOnLaunch`, `hideRiotClient`, `closeRiotClient` e `streamerMode` são apagadas de um `data.json` antigo ao carregar e somem do arquivo no próximo salvamento ([[ADR-028 Modo antigo removido]]).
- **Campos de chave na edição:** `undefined` mantém, `''` remove, qualquer outro valor substitui. Senha em branco na edição mantém a atual.
- **Nomes limpos.** Riot IDs copiados do cliente trazem marcas invisíveis de direção (U+2066 a U+2069) e caracteres parecidos (U+200B a U+200F, U+202A a U+202E, U+FEFF) que fazem toda consulta à API falhar; `cleanName` remove esses caracteres.

## O que os cartões veem

`publicAccount` devolve a conta sem a senha, só com `hasPassword` e `hasSession`. Senhas só saem do store no main, para o login.

## Fora do `%APPDATA%`

`.client-integration/` (na raiz do projeto, fora do git) guardava a cópia privada do Riot, o perfil Chromium dela e os logs do host. O código não a usa desde 2026-11-07, e o usuário pode apagá-la. Ela contém recursos proprietários da Riot e nunca pode ser distribuída. Um `riot-client-bridge.json` antigo em `%APPDATA%\riot-account-manager\` também ficou sem uso. Ver [[Integração com o Riot Client]].
