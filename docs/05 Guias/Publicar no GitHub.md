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

Desde 2026-11-20 cada versão sai como release público em `arthurmchd/riot-account-manager`, pedido do usuário ("um release para qualquer um poder baixar"). O primeiro foi o `v2.15.1`. O `gh` (GitHub CLI) está instalado em `C:\Program Files\GitHub CLI\gh.exe`, com login feito pelo próprio usuário (`gh auth login --web`).

1. Com a versão nova já gerada e testada, junte o `migracao/tauri` no `main` por PR, como os anteriores: `gh pr create --base main --head migracao/tauri` e `gh pr merge <n> --merge`.
2. Calcule o SHA-256: `Get-FileHash src-tauri\target\release\bundle\nsis\Eclipse_<versão>_x64-setup.exe`.
3. Crie o release com o Setup, a tag `v<versão>` no `main`, as novidades em linguagem de usuário, o SHA-256, o aviso do SmartScreen e o aviso de projeto de fã: `gh release create v<versão> <Setup> --target main --title "Eclipse <versão>" --notes-file <notas> --latest`.
4. Confira que o `digest` do arquivo no release (`gh release view v<versão> --json assets`) bate com o SHA-256.

Só o Setup vai no release: nunca dados, logs, `.client-integration/`, `app.asar` ou capturas com contas.

## Para quem baixar

O caminho normal é o Setup do release mais recente (seção "Baixar" do README). Para gerar do código: `npm ci` e `cargo tauri build` em `src-tauri/`. As contas não acompanham o código nem o Setup.

Referências: [adicionar código local ao GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github), [ignorar arquivos](https://docs.github.com/en/get-started/git-basics/ignoring-files), [remover dados sensíveis](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
