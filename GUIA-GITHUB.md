# Publicar este projeto no GitHub

O `.gitignore` está preparado para versionar o código e deixar dados pessoais, dependências, registros e cópias da instalação Riot fora do repositório. Nenhum repositório remoto foi criado e nada foi enviado ao GitHub durante essa preparação.

## O que subir

- `main.js`, `preload.js`, `src/`, `renderer/`, `scripts/` e `test/`, respeitando as exclusões do `.gitignore`.
- `package.json` **e `package-lock.json`**. Quem baixar o projeto instala as dependências; não recebe seu `node_modules`.
- `.gitignore`, os arquivos `.md` e os atalhos `.bat` da raiz.

Antes de tornar o projeto público, confira a origem e as condições de distribuição das imagens em `renderer/assets/`. Não escolha uma licença para arquivos de terceiros como se fossem de sua autoria.

## O que deixar fora

- `node_modules/`, `dist/`, `out/` e arquivos temporários.
- **Toda a pasta `.client-integration/`**: contém cópias da interface Riot, perfis, registros e resultados de testes locais. Quem baixar o código deverá preparar sua própria cópia a partir da instalação Riot compatível. Não envie esses arquivos em Releases, ZIPs ou anexos de issues.
- `app.asar`, executáveis e bibliotecas copiados da instalação Riot.
- Contas, usuários, senhas, chaves de API, sessões, backups e o arquivo de descoberta da ponte local, **mesmo criptografados**.
- Registros, capturas de tela e dumps que possam mostrar contas ou informações pessoais.
- `.env`, chaves privadas e configurações pessoais de ferramentas.
- `scripts/merge-claude-*` e `scripts/verify-decrypt/`: ferramentas locais de recuperação/diagnóstico de dados, sem necessidade para executar o aplicativo.

Os dados normais do aplicativo ficam em `%APPDATA%\riot-account-manager`, fora desta pasta de código. Não copie essa pasta para dentro do repositório nem a envie como anexo.

## Passo a passo pelo PowerShell

1. No GitHub, crie um repositório novo. Você pode começar como **Private**. Deixe desmarcadas as opções de criar README, `.gitignore` e licença: o projeto já contém seus próprios arquivos.
2. Abra o PowerShell na pasta do projeto e execute:

```powershell
cd "C:\Users\turia\Desktop\riot-account-manager"
git init -b main
git add .
git status --short
git diff --cached --stat
git diff --cached
```

3. Revise a lista e o conteúdo preparado. Não devem aparecer `node_modules`, `.client-integration`, contas, sessões, registros, chaves ou ferramentas locais de recuperação. Você está preparando um commit local; nada foi publicado ainda.
4. Depois da revisão:

```powershell
git commit -m "Initial commit"
```

Se o Git pedir sua identificação, configure seu nome e o e-mail que deseja associar aos commits e repita o commit:

```powershell
git config user.name "Seu nome"
git config user.email "Seu email do GitHub ou email noreply"
```

5. Copie a URL HTTPS do repositório criado no GitHub. No comando abaixo, substitua **toda a URL de exemplo** pela URL real:

```powershell
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

Conclua a autenticação do GitHub quando solicitada. Não coloque sua senha nem um token diretamente na URL do repositório ou nos arquivos do projeto.

## Próximas atualizações

```powershell
git add .
git diff --cached --stat
git diff --cached
git commit -m "Descreva a alteracao"
git push
```

O `.gitignore` não remove arquivos já versionados e não apaga segredos do histórico. Se um segredo já tiver sido publicado, revogue/troque esse segredo e siga o procedimento de remoção do histórico; apenas excluir o arquivo no próximo commit não basta. Não use `git add -f` para incluir os arquivos excluídos.

## Instalação para quem baixar

```powershell
npm ci
npm start
```

O modo integrado requer uma instalação Riot compatível e a preparação local descrita em `INTEGRACAO-RIOT.md`. Os dados de contas não acompanham o código.

Referências: [adicionar código local ao GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github), [ignorar arquivos](https://docs.github.com/en/get-started/git-basics/ignoring-files) e [remover dados sensíveis](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
