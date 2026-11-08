# Eclipse

Gerenciador de contas Riot (antes chamado Riot Account Manager; a pasta do projeto e a de dados continuam `riot-account-manager`).

Cartões de contas presos à janela oficial do Riot Client, sobre a arte à direita da coluna de login: cadastro, edição, configurações, elos e abertura de League of Legends (e TFT) e VALORANT. O serviço fica na bandeja; você abre a Riot pelo atalho normal.

Cada cartão mostra nome, nível e, para Solo/Duo e Flex lado a lado (Competitivo no VALORANT), elo, winrate, vitórias e derrotas. Cadastro e configurações usam diálogos compactos. A caixa "Ocultar contas" mostra a arte da Riot de volta.

- Senhas, chaves e sessões criptografadas com o DPAPI do Windows
- Primeira entrada de cada conta preenchida no formulário da Riot; depois, com "Manter login", entrada em segundo plano com a sessão guardada da conta
- A Riot sempre abre desconectada, na tela de login com os cartões
- Não altera a instalação da Riot, não contorna CAPTCHA nem 2FA e não mexe nos jogos nem no Vanguard

## Instalar

```powershell
npm ci
npm run dist
```

Rode `dist\Eclipse Setup <versão>.exe`. Ele instala na sua conta do Windows, sem pedir administrador, cria os atalhos "Eclipse" no menu Iniciar e na Área de Trabalho e abre o Eclipse na bandeja. O Setup não é assinado: se o Windows avisar, use **Mais informações** → **Executar assim mesmo**. As contas ficam em `%APPDATA%\riot-account-manager\`, as mesmas do `npm start`, e a desinstalação não as apaga.

Na bandeja, **Iniciar com o Windows** abre o Eclipse quando você entra no Windows. Vem desmarcado. Para atualizar, saia pela bandeja e rode o Setup novo por cima.

## Rodar do projeto

```powershell
npm ci
npm start
```

Inicie por `Abrir Riot com minhas contas.bat` (instala as dependências na primeira vez), `Iniciar gerenciador de contas.bat` ou `npm start`, depois abra o Riot Client normalmente. Os cartões aparecem presos à janela da Riot e a acompanham. Pela bandeja, **Contas no Riot** abre a Riot com os cartões e **Abrir Riot Client** abre só a Riot. Encerre a instância antiga pela bandeja antes de atualizar. Rodando do projeto, a opção **Iniciar com o Windows** não aparece.

Ao clicar em **Jogar**, o botão vira **Cancelar** enquanto o Eclipse entra na conta. Quando a janela do jogo abre, a janela da Riot é fechada. 2FA, CAPTCHA e outras verificações aparecem na própria tela da Riot.

O modo antigo, com uma cópia privada da interface da Riot (`npm run start:private`), saiu em 2026-11-07. O código está na tag `modo-antigo-final`.

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
  main/              serviço principal Electron na bandeja, sem janela própria
  core/              armazenamento, serviço de login, sessões, consulta de elos
  riot/              controle do Riot Client e fluxo de login
  platform/windows/  janelas e auxiliares PowerShell
  integration/       sobreposição presa à Riot e leitura da API local
  renderer/          os cartões
scripts/dev/         prévia no navegador
test/                espelha src/
docs/                vault do Obsidian
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Inicia o Eclipse na bandeja; abra a Riot normalmente |
| `npm test` | Roda os testes |
| `npm run preview` | Cartões no navegador com contas fictícias (<http://localhost:5178>) |

## Aviso

Automatizar o Riot Client é zona cinzenta nos termos da Riot; o risco é de quem usa. Se existir uma pasta `.client-integration/` de uma versão antiga, ela contém recursos proprietários da Riot e nunca deve ser distribuída.
