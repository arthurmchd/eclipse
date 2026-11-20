# Eclipse

Gerenciador de contas Riot (antes chamado Riot Account Manager; a pasta do projeto e a de dados continuam `riot-account-manager`).

Cartões de contas presos à janela oficial do Riot Client, sobre a arte à direita da coluna de login: cadastro, edição, configurações, elos e abertura de League of Legends (e TFT) e VALORANT. O serviço fica na bandeja; você abre a Riot pelo atalho normal.

Cada cartão mostra nome, nível e, para Solo/Duo e Flex lado a lado (Competitivo no VALORANT), elo, winrate, vitórias e derrotas. Cadastro e configurações usam diálogos compactos. A caixa "Ocultar contas" mostra a arte da Riot de volta.

- Elos sem chave de API: lidos do LoL ou do VALORANT aberto quando a conta joga. Com chaves no ⚙, todas as contas se atualizam de uma vez
- Senhas, chaves e sessões criptografadas com o DPAPI do Windows
- Primeira entrada de cada conta preenchida no formulário da Riot; depois, com "Manter login", entrada em segundo plano com a sessão guardada da conta
- A Riot sempre abre desconectada, na tela de login com os cartões
- Não altera a instalação da Riot, não contorna CAPTCHA nem 2FA e não mexe nos jogos nem no Vanguard

## Baixar

Baixe o `Eclipse_<versão>_x64-setup.exe` da [versão mais recente](https://github.com/arthurmchd/riot-account-manager/releases/latest) e rode. Só Windows 10 ou 11, sem pedir administrador.

O Setup não é assinado, então o Windows mostra "O Windows protegeu o computador": clique em **Mais informações** → **Executar assim mesmo**. Cada versão traz o SHA-256 do Setup nas notas, para conferir o arquivo com `Get-FileHash Eclipse_<versão>_x64-setup.exe`.

O Eclipse não é endossado pela Riot Games e não reflete as opiniões da Riot Games nem de ninguém envolvido oficialmente na produção ou no gerenciamento das propriedades da Riot Games. Riot Games, League of Legends, VALORANT, Teamfight Tactics, 2XKO e Legends of Runeterra são marcas da Riot Games, Inc.

## Instalar a partir do código

```powershell
npm ci
cd src-tauri
cargo tauri build
```

Rode `src-tauri\target\release\bundle\nsis\Eclipse_<versão>_x64-setup.exe`. Ele instala na sua conta do Windows, sem pedir administrador, em `%LOCALAPPDATA%\Eclipse`, e cria o atalho "Eclipse" no menu Iniciar. O Setup não é assinado: se o Windows avisar, use **Mais informações** → **Executar assim mesmo**. As contas ficam em `%APPDATA%\riot-account-manager\`, e a desinstalação não as apaga. Se achar o Eclipse antigo em Electron instalado, o Setup o desinstala antes, mantendo as contas e o início com o Windows.

Abra pelo atalho; o Eclipse fica na bandeja. Na bandeja, **Iniciar com o Windows** abre o Eclipse quando você entra no Windows. Para atualizar, saia pela bandeja e rode o Setup novo por cima.

Pela bandeja, **Contas no Riot** abre a Riot com os cartões e **Abrir Riot Client** abre só a Riot. Ao clicar em **Jogar**, o botão vira **Cancelar** enquanto o Eclipse entra na conta. Quando a janela do jogo abre, a janela da Riot é fechada. 2FA, CAPTCHA e outras verificações aparecem na própria tela da Riot.

## Rodar do projeto

```powershell
$env:ECLIPSE_DATA_DIR = "C:\pasta\de\teste"
cd src-tauri
cargo run
```

Em desenvolvimento, o Eclipse só abre com `ECLIPSE_DATA_DIR` apontando para uma pasta escolhida à mão, para nunca abrir as contas reais por acidente. A opção **Iniciar com o Windows** não aparece.

O Eclipse em Electron saiu em 2026-11-15 (a 2.0.0 é a primeira versão só em Tauri); o código está na tag `electron-final`. O modo antigo, com uma cópia privada da interface da Riot, saiu em 2026-11-07 e está na tag `modo-antigo-final`.

Requisitos: Windows 10/11, Rust com o `tauri-cli` (`cargo install tauri-cli`) e Node.js 22+ (para as fontes, a prévia e os testes JS).

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
src-tauri/           o app: Rust, Tauri, Setup e testes
  src/application/   armazenamento, serviço de login, sessões, elos
  src/riot/          controle do Riot Client e fluxo de login
  src/platform/      janelas, DPAPI, início com o Windows, notificações
  src/integration/   sobreposição presa à Riot, cartões e API local
src/
  renderer/          os cartões
  integration/       caixa, cobertura e o preload dos cartões
  platform/windows/  auxiliares PowerShell
scripts/dev/         prévia no navegador
test/                testes JS dos cartões, do preload e dos .ps1
docs/                vault do Obsidian
```

## Comandos

| Comando | O que faz |
|---|---|
| `cargo test` (em `src-tauri/`) | Roda os testes do app |
| `cargo tauri build` (em `src-tauri/`) | Gera o Setup |
| `npm test` | Roda os testes JS |
| `npm run preview` | Cartões no navegador com contas fictícias (<http://localhost:5178>) |

## Aviso

Automatizar o Riot Client é zona cinzenta nos termos da Riot; o risco é de quem usa. Se existir uma pasta `.client-integration/` de uma versão antiga, ela contém recursos proprietários da Riot e nunca deve ser distribuída.
