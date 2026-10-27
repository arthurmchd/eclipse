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
- **Toda a pasta `.client-integration/`**: cópias da interface Riot, perfis, logs e resultados de testes. Nunca envie em Releases, ZIPs ou issues.
- `app.asar`, executáveis e bibliotecas da instalação Riot
- Contas, usuários, senhas, chaves, sessões, backups e `riot-client-bridge.json`, **mesmo criptografados**
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

## Para quem baixar

```powershell
npm ci
npm start
```

O modo integrado exige uma instalação Riot compatível e a preparação local ([[Integração com o Riot Client]]). As contas não acompanham o código.

Referências: [adicionar código local ao GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github), [ignorar arquivos](https://docs.github.com/en/get-started/git-basics/ignoring-files), [remover dados sensíveis](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
