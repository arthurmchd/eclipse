# Eclipse

Gerenciador de contas Riot (antes chamado Riot Account Manager; a pasta do projeto e a de dados continuam `riot-account-manager`).

Gerenciamento de contas em uma sobreposição que acompanha o Riot Client oficial: cadastro, edição, configurações, elos e abertura de League of Legends, Teamfight Tactics e VALORANT. O serviço fica na bandeja; você abre o Riot pelo atalho normal.

A interface padrão mostra cartões de contas diretamente sobre a arte dos personagens, nos 70% direitos da janela. O login à esquerda fica livre. Cada cartão mostra nome, nível e, para Solo/Duo e Flex lado a lado (Competitivo no VALORANT), rank, winrate, vitórias e derrotas; cadastro e configurações usam diálogos compactos. A interface completa antiga continua apenas no modo privado de compatibilidade.

- Senhas, chaves e sessões criptografadas com o DPAPI do Windows
- Troca de conta reaproveitando a sessão salva pelo próprio Riot, com o cliente oculto
- Interface completa em **Contas**, disponível sobre a janela oficial enquanto ela está em primeiro plano
- Não contorna CAPTCHA nem 2FA e não mexe nos jogos nem no Vanguard

## Início rápido

Em uma instalação nova do projeto, com o Riot Client compatível instalado:

```powershell
npm ci
npm start
```

Inicie por `Iniciar gerenciador de contas.bat` ou `npm start`, depois abra o Riot Client normalmente. O serviço não abre o Riot sozinho na inicialização. Clique em **Contas**, no canto superior direito. O painel acompanha o cliente e some quando ele é minimizado ou outro aplicativo recebe foco. Encerre a instância antiga pela bandeja antes de atualizar. O início automático com Windows não é ativado.

O modo anterior com cópia privada continua disponível por `npm run start:private` e exige `npm run integration:prepare-private`. A sobreposição padrão dispensa essa preparação. O `.bat` antigo passa a iniciar o mesmo serviço em segundo plano.

Na janela Riot, use **Contas** para abrir o gerenciamento completo e **Voltar ao Riot** para retornar. Os dados e as sessões salvas são preservados. Fechar a visualização não cancela um login em andamento; a bandeja oferece recuperação do cliente, cancelamento e saída.

Após Play no modo sobreposto, o Riot fica visível com carregamento e Cancelar. Quando a janela do jogo estiver pronta, a janela Riot recebe o pedido de fechamento. Verificações, falhas e cancelamento mantêm a interface acessível.

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
  main/              serviço principal Electron, sem janela própria
  core/              armazenamento, serviço de login, consulta de elos
  riot/              controle do Riot Client e fluxo de login
  platform/windows/  janelas, DPAPI e auxiliares PowerShell
  integration/       cópia privada, ponte, addons e visualização de contas isolada
  renderer/          interface completa exibida dentro da janela Riot
scripts/             dev, integration e legacy
test/                espelha src/
docs/                vault do Obsidian
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Inicia a sobreposição na bandeja; abra o Riot normalmente |
| `npm run start:riot-login` | Alias para o serviço de sobreposição |
| `npm run start:private` | Modo anterior com cópia privada preparada |
| `npm test` | Roda os testes |
| `npm run preview` | Interface no navegador com contas fictícias (<http://localhost:5178>) |
| `npm run integration:prepare-private` | Prepara a cópia privada da interface do Riot |
| `npm run integration:probe-private` | Verifica a cópia privada sem fazer login |

## Aviso

Automatizar o Riot Client é zona cinzenta nos termos da Riot; o risco é de quem usa. A pasta `.client-integration/` contém recursos proprietários da Riot e nunca deve ser distribuída.
