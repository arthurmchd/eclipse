# Riot Account Manager

Painel para Windows que entra em várias contas da Riot com um clique (League of Legends, Teamfight Tactics e VALORANT) e mostra o elo de cada conta com os emblemas oficiais.

- Senhas, chaves e sessões criptografadas com o DPAPI do Windows
- Troca de conta reaproveitando a sessão salva pelo próprio Riot, com o cliente oculto
- Modo experimental com o painel **MINHAS CONTAS** dentro da tela de login real do Riot
- Não contorna CAPTCHA nem 2FA e não mexe nos jogos nem no Vanguard

## Início rápido

```powershell
npm ci
npm start
```

Ou dois cliques em `Abrir Riot Account Manager.bat`. Para o login integrado, `Abrir Riot com minhas contas.bat` (exige preparar a cópia privada; veja a documentação).

Requisitos: Windows 10/11 e Node.js 22+.

## Documentação

A documentação completa é um vault do Obsidian em [`docs/`](docs/00%20Início.md). Abra a pasta `docs` como vault no Obsidian ou navegue pelos arquivos:

| Assunto | Nota |
|---|---|
| Visão geral e uso | [Visão geral](docs/01%20Visão%20geral/Visão%20geral.md) · [Como usar](docs/01%20Visão%20geral/Como%20usar.md) |
| Arquitetura | [Arquitetura](docs/02%20Arquitetura/Arquitetura.md) · [Estrutura de pastas](docs/02%20Arquitetura/Estrutura%20de%20pastas.md) · [Fluxo de login](docs/02%20Arquitetura/Fluxo%20de%20login.md) |
| Segurança | [Segurança e privacidade](docs/02%20Arquitetura/Segurança%20e%20privacidade.md) · [Armazenamento e dados](docs/02%20Arquitetura/Armazenamento%20e%20dados.md) |
| Integração com o Riot | [Integração com o Riot Client](docs/02%20Arquitetura/Integração%20com%20o%20Riot%20Client.md) · [Atualização do Riot Client](docs/05%20Guias/Atualização%20do%20Riot%20Client.md) |
| Desenvolvimento | [Desenvolvimento](docs/05%20Guias/Desenvolvimento.md) · [Backlog](docs/06%20Roadmap/Backlog.md) |

## Estrutura

```
src/
  main/              processo principal Electron e preload
  core/              armazenamento, serviço de login, consulta de elos
  riot/              controle do Riot Client e fluxo de login
  platform/windows/  janelas, DPAPI e auxiliares PowerShell
  integration/       cópia privada da interface do Riot, ponte local e addons
  renderer/          interface do gerenciador
scripts/             dev, integration e legacy
test/                espelha src/
docs/                vault do Obsidian
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Abre o gerenciador |
| `npm run start:riot-login` | Abre no modo login integrado |
| `npm test` | Roda os testes |
| `npm run preview` | Interface no navegador com contas fictícias (<http://localhost:5178>) |
| `npm run integration:prepare-private` | Prepara a cópia privada da interface do Riot |
| `npm run integration:probe-private` | Verifica a cópia privada sem fazer login |

## Aviso

Automatizar o Riot Client é zona cinzenta nos termos da Riot; o risco é de quem usa. A pasta `.client-integration/` contém recursos proprietários da Riot e nunca deve ser distribuída.
