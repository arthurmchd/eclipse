---
tipo: decisão
status: aceita
data: 2026-11-08
tags: [adr, produto, distribuição]
---

# ADR-030 Eclipse instalado por um Setup próprio

Pedido do usuário em 2026-11-08: o Eclipse deve funcionar como o Rose, um programa instalado que fica em segundo plano na bandeja. É a primeira parte do item 20 do [[Backlog]] ("Instalador e atualização").

## Contexto

Até aqui o Eclipse só rodava a partir do projeto: `npm start` no VS Code, `Iniciar gerenciador de contas.bat` ou `Abrir Riot com minhas contas.bat`, que chamam o `electron.exe` de `node_modules`. Para usar o app todo dia, o usuário precisava abrir o editor ou a pasta do código.

Três detalhes do projeto limitam como empacotar:

- **Pasta de dados.** O Electron deriva `%APPDATA%\riot-account-manager\` do `package.json` (`productName` no topo, se existir; senão `name`). As contas, as sessões e o `Local State` com a chave do `safeStorage` ([[ADR-002 Segredos protegidos pelo DPAPI]]) vivem nela. Outro nome de pasta faria o app instalado abrir sem nenhuma conta.
- **Auxiliares PowerShell.** O PowerShell não lê arquivos dentro do `app.asar`. O [[paths]] já troca `app.asar` por `app.asar.unpacked` em `windowsHelper`, mas os `.ps1` precisam estar lá.
- **Projeto com dados locais.** A raiz do projeto tem pastas ignoradas pelo Git, como `backups/`, que podem guardar dados de contas. O pacote não pode levar nada além do código.

## Decisão

- **electron-builder 26.18.0**, fixo em `devDependencies`, gera `dist/Eclipse Setup <versão>.exe` com `npm run dist`. A versão de 2026-10-20 foi escolhida por ter mais de duas semanas; a 26.18.1, de 2026-10-26, ainda era nova demais.
- **Instalador NSIS de um clique, por usuário.** Não pede administrador, instala na pasta de programas do usuário, cria atalhos "Eclipse" no menu Iniciar e na Área de Trabalho, abre o Eclipse no fim e aparece em "Aplicativos instalados" com desinstalador.
- **Mesma pasta de dados.** O `name` continua `riot-account-manager`. O nome "Eclipse" vai só em `build.productName`, que nomeia o executável, os atalhos e o Setup, e nunca no topo do `package.json`. A desinstalação não apaga a pasta de dados. A chave do `safeStorage` fica no `Local State` dessa pasta, protegida pelo DPAPI do usuário, então o Eclipse instalado abre as mesmas contas que o `npm start`. Isso é conferido no pacote gerado: o `package.json` dentro do `app.asar` precisa ter `name: riot-account-manager` e nenhum `productName`.
- **Só o código entra no pacote.** `files` lista apenas `src/**/*` e `package.json`; o electron-builder soma as dependências de produção (as fontes `@fontsource`). Os `.ps1` de `src/platform/windows/` ficam fora do `app.asar` (`asarUnpack`).
- **O mesmo Electron dos testes.** O pacote usa o Electron 44.9.3 fixado em `devDependencies`, pelo mesmo zip oficial que o `npm install` guardou no cache do Electron. O primeiro build, com `electronDist` apontando para `node_modules/electron/dist`, levou junto o `default_app.asar` e o arquivo `version`; pelo zip, o electron-builder os tira.
- **Nada de atualização embutida.** `publish: null` impede o `app-update.yml` e o `latest.yml`, e `packElevateHelper: false` tira o `elevate.exe`, que só serve para instalar por máquina. O campo `author` do `package.json` vira a empresa do executável, o copyright e o editor na lista de programas do Windows; sem ele, o Windows mostrava "GitHub, Inc.", herdado do Electron. Desde a revisão de 2026-11-08 é "Eclipse", e o `appId` é `Eclipse.AccountManager`: o Setup vai para amigos e não leva o nome nem o usuário do GitHub do autor. O `appId` define a chave de desinstalação, então `nsis.guid` fica fixo na chave do primeiro Setup (`1cee5ad5-fb20-5488-b349-ffcaaa593158`), e um Setup novo continua instalando por cima do antigo.
- **Uso pessoal.** O ícone veio do usuário e parece arte de jogo da Riot ([[paths]]). O Setup é para a máquina do usuário, não para distribuição pública.
- **Iniciar com o Windows é escolha do usuário.** O menu da bandeja ganha a opção "Iniciar com o Windows", desligada por padrão, que só aparece no app instalado (`app.isPackaged`). Ligada, grava o valor `Eclipse` na chave `Run` do usuário (`HKCU`) pelo `app.setLoginItemSettings` do Electron; desligada, remove. O módulo é o [[startWithWindows]]. Ao iniciar com o Windows, o Eclipse faz o mesmo que pelo atalho: fica na bandeja e não abre a Riot.
- **Desinstalar limpa o início com o Windows.** O desinstalador apaga o valor `Eclipse` da chave `Run` e da `StartupApproved\Run` do usuário, menos quando roda por causa de uma versão nova instalada por cima (`isUpdated`). O script fica em `scripts/build/installer.nsh`.
- **Sem assinatura e sem atualização automática.** O Setup e o `Eclipse.exe` não são assinados, então o SmartScreen avisa na primeira vez ("Mais informações" → "Executar assim mesmo"). Uma versão nova é um Setup novo instalado por cima, que mantém os dados.
- **O modo de desenvolvimento continua.** `npm start` e os dois `.bat` seguem rodando o código do projeto. Neles a opção "Iniciar com o Windows" não aparece, porque o executável seria o `electron.exe` de `node_modules`.

## Fora desta decisão

- **Assinatura de código.** Exige certificado pago. Continua no [[Backlog]].
- **Atualização automática e versionamento do `data.json`.** Continuam no [[Backlog]]. Hoje o formato do `data.json` só ganha campos, e o [[store]] preenche com o padrão os que faltam num arquivo antigo.
- **Fuses do Electron** (desligar `RunAsNode`, validar a integridade do `app.asar`). Endurecem o executável, mas outro programa do mesmo usuário já consegue abrir o DPAPI dele. Ficam no [[Backlog]].

## Alternativas consideradas

- **Pasta portátil (`.exe` sem instalar).** Não cria atalhos nem aparece em "Aplicativos instalados", e a versão nova precisa ser copiada à mão. O usuário escolheu o instalador.
- **Setup com assistente (escolher pasta, por máquina).** Pede mais cliques e, por máquina, pede administrador sem necessidade.
- **Iniciar com o Windows ligado por padrão.** O usuário escolheu a opção desligada.
- **Mudar o `name` para `eclipse` e migrar os dados.** Mexeria em sessões e chaves protegidas pelo DPAPI sem ganho para o usuário.
- **electron-forge ou electron-packager direto.** O electron-builder já traz o NSIS por usuário, o `asarUnpack` e o desinstalador sem código próprio.

## Consequências

- O usuário instala uma vez e abre o Eclipse pelo menu Iniciar, pela Área de Trabalho ou com o Windows, sem o VS Code.
- `npm run dist` baixa o NSIS do electron-builder na primeira vez e leva alguns minutos. `dist/` não é versionada.
- Uma mudança de nome do pacote, um `productName` no topo ou um `app.setName` passam a quebrar também o app instalado. A conferência do `package.json` dentro do `app.asar` vale para todo build.
- Um `.ps1` novo em `src/platform/windows/` sai do `app.asar` sozinho pelo `asarUnpack`. Um auxiliar em outra pasta precisa entrar na lista.
- Atualizar com o Eclipse aberto: o Setup tenta fechar o Eclipse antes de copiar os arquivos. Fechado assim, ele não passa pela saída ordenada do [[main]]; o recomendado é sair pela bandeja antes.

## Relacionado

- [[Arquitetura]]
- [[Segurança e privacidade]]
- [[Desenvolvimento]]
- [[Estudo - Comparação com o Rose]]
