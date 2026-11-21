---
tipo: guia
tags: [git, publicação]
---

# Publicar no GitHub

O `.gitignore` versiona o código e deixa fora dados pessoais, dependências, logs e cópias da instalação Riot.

## O que sobe

- `src/`, `scripts/`, `test/` e `docs/` (este vault, sem o estado da área de trabalho do Obsidian)
- `package.json` **e** `package-lock.json`
- `README.md`, `CLAUDE.md`, `.gitignore`, `.gitattributes`, `.editorconfig` e os atalhos `.bat`
- `.claude/agents/`, com os agentes do projeto

Antes de tornar o repositório público, confira a origem e as condições de distribuição das imagens em `src/renderer/assets/`. Não escolha uma licença para arquivos de terceiros como se fossem seus.

## O que fica fora

- `node_modules/`, `dist/`, `out/`, temporários
- **Toda a pasta `.client-integration/`**, se ainda existir: sobra do modo antigo, com cópias da interface Riot, perfis e logs. Nunca envie em Releases, ZIPs ou issues; o usuário pode apagá-la.
- `app.asar`, executáveis e bibliotecas da instalação Riot
- Contas, usuários, senhas, chaves, sessões, backups e um `riot-client-bridge.json` antigo, **mesmo criptografados**
- Logs, capturas de tela e dumps que mostrem contas
- `.env`, chaves privadas, configurações pessoais (`.claude/` exceto `agents/`)
- `scripts/merge-claude-*` e `scripts/verify-decrypt/`: ferramentas locais de recuperação de dados

Os dados do app ficam em `%APPDATA%\riot-account-manager`, fora do projeto. Nunca copie essa pasta para dentro do repositório.

## Primeira publicação

1. No GitHub, crie um repositório novo (pode começar **Private**), sem README, `.gitignore` ou licença.
2. Revise o que vai subir:

```powershell
git status --short
git diff --cached --stat
```

3. Não devem aparecer `node_modules`, `.client-integration`, contas, sessões, logs, chaves ou ferramentas de recuperação.
4. Conecte e envie, trocando a URL de exemplo pela real:

```powershell
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

Conclua a autenticação do GitHub quando pedida. Nunca coloque senha ou token na URL ou em arquivos do projeto.

## Atualizações

```powershell
git add .
git diff --cached --stat
git commit -m "Descreva a alteração"
git push
```

O `.gitignore` não remove arquivos já versionados nem apaga segredos do histórico. Se um segredo foi publicado, revogue/troque e siga o procedimento de remoção do histórico. Não use `git add -f` nos arquivos excluídos.

## Releases

Desde 2026-11-20 cada versão sai como release público em `arthurmchd/eclipse`, pedido do usuário ("um release para qualquer um poder baixar"). O primeiro foi o `v2.15.1`. O repositório se chamava `riot-account-manager` e foi renomeado para `eclipse` em 2026-11-20, a pedido do usuário; o GitHub redireciona os endereços antigos. O `gh` (GitHub CLI) está instalado em `C:\Program Files\GitHub CLI\gh.exe`, com login feito pelo próprio usuário (`gh auth login --web`).

### Antes de publicar

1. **Testes no GitHub.** O envio para `migracao/tauri` roda `.github/workflows/tests.yml` (clippy sem avisos, `cargo test` e `npm test` no Windows). Só siga com tudo verde: `gh run list --branch migracao/tauri --limit 1`.
2. **Riot real, sem login.** Com a Riot aberta na tela de login, rode `cargo run --example riot_check` em `src-tauri/`. Ela confere a versão da Riot contra a última conferida ([[riotVersion]]), o observador, o formulário pelas cores e os dois campos do UI Automation, sem digitar nada. Precisa de autorização do usuário a cada vez ([[Testes sem o usuário]]).
3. **Um login real.** Com o Eclipse instalado da versão nova, entre com uma conta sem 2FA e confira no `sign-in.log` a linha `credentials entered (input:uia, …)` ou a sessão salva e o "Game opened". Também precisa de autorização.
4. Se a Riot subiu de versão principal e tudo passou, suba `LAST_TESTED_MAJOR` ([[Atualização do Riot Client]]).

### Gerar e publicar

1. Gere o Setup com a chave de assinatura: o `cargo tauri build` lê `TAURI_SIGNING_PRIVATE_KEY` (o caminho de `%USERPROFILE%\.tauri\eclipse-updater.key`, gravado nas variáveis do usuário em 2026-11-21) e cria, ao lado do Setup, o `Eclipse_<versão>_x64-setup.exe.sig` ([[ADR-045 Atualização pelo GitHub]]).
2. Escreva as novidades em linguagem de usuário num arquivo e gere o manifesto: `node scripts/release/latest-json.js <notas>`. Ele cria `latest.json` na pasta do Setup, apontando para o Setup da tag `v<versão>`, com a assinatura do `.sig`.
3. Junte o `migracao/tauri` no `main` por PR, como os anteriores: `gh pr create --base main --head migracao/tauri` e `gh pr merge <n> --merge`.
4. Calcule o SHA-256: `Get-FileHash src-tauri	argeteleaseundle
sis\Eclipse_<versão>_x64-setup.exe`.
5. Crie o release com os três arquivos (Setup, `.sig` e `latest.json`), a tag `v<versão>` no `main`, as novidades, o SHA-256, o aviso do SmartScreen e o aviso de projeto de fã: `gh release create v<versão> <Setup> <Setup>.sig <pasta>\latest.json --target main --title "Eclipse <versão>" --notes-file <notas> --latest`.
6. Confira que o `digest` do Setup no release (`gh release view v<versão> --json assets`) bate com o SHA-256 e que `https://github.com/arthurmchd/eclipse/releases/latest/download/latest.json` abre com a versão nova. Os Eclipse instalados avisam em até 12 horas.

### A chave de assinatura

- Fica em `%USERPROFILE%\.tauri\eclipse-updater.key`, sem senha, com a pública em `eclipse-updater.key.pub` (a mesma do `tauri.conf.json`). Guarde uma cópia fora do PC, num lugar só seu.
- Nunca vai para o repositório, para um release ou para uma issue. O `.gitignore` barra `*.key`.
- Perdida, os Eclipse instalados não aceitam mais atualizações: gere outra chave, troque a pública no `tauri.conf.json` e avise no release que essa versão precisa ser baixada à mão.
- Vazada, gere outra do mesmo jeito: quem tiver a antiga poderia assinar um Setup falso.

No release vão só o Setup, o `.sig` e o `latest.json`: nunca a chave, dados, logs, `.client-integration/`, `app.asar` ou capturas com contas.

## Capturas do README

O README é em inglês e mostra o Eclipse dentro da janela inteira do Riot Client (`.github/assets/league.png`, `valorant.png` e `list.png`). Capturar a janela da Riot vai contra [[Testes sem o usuário]], então refazer exige pedir ao usuário de novo. Como foi feito em 2026-11-20:

1. Com a Riot aberta na tela de login e sem jogo, fechar o Eclipse instalado.
2. Montar uma pasta de teste com as contas de `scripts/dev/mock-api.js`, senha de mentira, `language: "en"` e `refreshMinutes: 0`, para os elos fictícios não serem trocados pelo OP.GG.
3. Rodar `target/debug/eclipse.exe` com `ECLIPSE_DATA_DIR` apontando para ela (o app instalado ignora essa variável) e restaurar a janela da Riot.
4. Capturar a Riot e a janela do Eclipse com `PrintWindow` e juntar as duas. A parte transparente do Eclipse sai preta; o preto puro fora do painel de cartões vira transparente.
5. Para outra aba ou modo, mudar `cardLayout` na pasta de teste e reabrir. A aba do jogo não fica salva: o VALORANT veio da prévia no mesmo tamanho do painel (1136 × 864) e foi colado sobre a captura.
6. Fechar a cópia de teste, apagar a pasta, minimizar a Riot se ela estava minimizada e reabrir o Eclipse instalado.

## Para quem baixar

O caminho normal é o Setup do release mais recente (seção "Baixar" do README). Para gerar do código: `npm ci` e `cargo tauri build` em `src-tauri/`. As contas não acompanham o código nem o Setup.

Referências: [adicionar código local ao GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github), [ignorar arquivos](https://docs.github.com/en/get-started/git-basics/ignoring-files), [remover dados sensíveis](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
