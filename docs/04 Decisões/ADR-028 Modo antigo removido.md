---
tipo: decisão
status: aceita
data: 2026-11-07
tags: [adr, arquitetura, integração, segurança]
---

# ADR-028 Modo antigo removido

Substitui [[ADR-001 Cópia privada da interface do Riot]] e [[ADR-007 Interface completa dentro do Riot Client]]. Encerra a migração da [[ADR-009 Sobreposição no cliente oficial]]. É o item 17 da análise de remendos de 2026-11-06.

## Contexto

Desde a [[ADR-009 Sobreposição no cliente oficial]], o app normal abre no modo cartões, por cima da Riot oficial. O modo antigo só rodava com `--private-client` e o app normal nunca passava por ele. Mesmo assim, ele continuava mantido, testado e documentado, com mais de 3 mil linhas:

- uma cópia modificada da interface da Riot (`app.asar`), preparada a partir da instalação, com ganchos nos nomes minificados da Riot e marcadores conferidos em runtime;
- um Electron próprio para hospedar essa cópia, uma ponte HTTP local, um canal de inicialização e três addons;
- a janela antiga de gerenciamento (`index.html`, `app.js`, `styles.css`) e as opções que só ela mostrava;
- scripts de preparação e de sonda, a prévia ainda abrindo a janela antiga e uma página de sobreposição sem uso.

Essa é a parte que mais depende de cada versão da Riot e que mais pesa com os Termos de uso, porque modifica arquivos do cliente. O usuário decidiu removê-la em 2026-11-07, com uma tag no git para poder voltar.

## Decisão

- **A tag `modo-antigo-final` marca o último commit com o modo antigo** (`a4fe748`). Para recuperar qualquer peça: `git checkout modo-antigo-final -- <caminho>`.
- **Saem do código:**
  - a cópia privada e seu host: `privateClient`, `host/` (`hostEntry`, `privateHost`, `privateHostCore`, `privateRendererCore`), `bootstrapChannel`, `bridgeServer`, `status`;
  - o [[windowsDpapi]], que só protegia o token da ponte e o manifesto da cópia;
  - os addons (`src/integration/addon/`);
  - a janela antiga (`src/renderer/index.html`, `app.js`, `styles.css`);
  - a página de sobreposição sem uso (`overlay.html`, `overlay.js`, `overlay.css`, `overlay-preload.js`);
  - os scripts `scripts/integration/`, `scripts/legacy/` e `scripts/dev/preview-riot-integration.js`, e os comandos do `package.json` que os chamavam;
  - os testes desses módulos.
- **[[asar]] e [[backend]] ficam, só para leitura.** O [[riotTransport]] lê por eles o lockfile e o certificado raiz da Riot dentro do `app.asar` oficial. O [[asar]] perde a escrita (`appendToArchive`) e fica só com `openArchive`; o [[backend]] perde `verifyBackend`.
- **O [[main]] tem um modo só.** Sem `--private-client`, sem a ponte e sem a cópia privada. A bandeja abre a Riot oficial e os cartões.
- **A API da view de contas fica com o que os cartões usam.** O [[manager-preload]], o [[managerHost]] e o [[managerService]] perdem `patchAccount`, `forgetSession`, `copy`, `showRiotClient`, `pickClientPath`, `openDataFolder` e `closeManager`, que só a janela antiga chamava. Menos portas abertas para a view.
- **As opções da janela antiga saem:** `minimizeOnLaunch` (sem uso), `hideRiotClient`, `closeRiotClient` e `streamerMode`. O [[signInService]] usa os valores que o modo cartões já usava: Riot fechada antes do login e janela nunca escondida no login visível. Um `data.json` antigo com essas chaves é limpo ao carregar.
- **O aviso de falha da bandeja deixa de falar da cópia privada.** Passa a dizer que não foi possível abrir as contas no Riot e sugere tentar de novo pela bandeja.
- **A prévia (`npm run preview`) abre os cartões.**
- **A pasta `.client-integration/` fica onde está.** O código não a usa mais. Ela fica fora do git, e só o usuário decide se a apaga.

## Alternativas consideradas

- **Manter o modo antigo desligado.** Cada atualização da Riot continuaria exigindo conferir uma cópia que ninguém usa, e os testes dele continuariam rodando.
- **Mover o modo antigo para outro repositório.** Daria trabalho para manter algo sem uso. A tag guarda o código do mesmo jeito.
- **Remover só os arquivos e manter a API e as opções.** Deixaria portas abertas na view de contas e opções gravadas que nada lê.

## Consequências

- O app perde a opção `--private-client`. Tudo acontece na Riot oficial, sem alterar arquivos dela.
- As regras de segurança da cópia privada (manifesto, SHA-256, marcadores, bridge local) deixam de valer. As da sobreposição continuam ([[Segurança e privacidade]]).
- O agente `riot-update-checker`, que conferia a cópia privada a cada versão da Riot, perde o objeto e é removido.
- Os itens 11 (dividir o `signInFlow`), 16 (helpers PowerShell) e 18 (fábrica do `riotClient`) da análise ficam menores. Os modos de login antigos dentro do [[signInFlow]] ficam para o item 11.
- Se o caminho da Riot não for detectado sozinho, não há mais tela para escolhê-lo. Isso já valia no modo cartões, que nunca mostrava a janela antiga.

## Relacionado

- [[ADR-001 Cópia privada da interface do Riot]]
- [[ADR-007 Interface completa dentro do Riot Client]]
- [[ADR-009 Sobreposição no cliente oficial]]
- [[main]]
- [[managerService]]
- [[Segurança e privacidade]]
