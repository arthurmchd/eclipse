---
tipo: decisão
status: aceita
data: 2026-11-13
tags: [adr, arquitetura, distribuição, segurança]
---

# ADR-034 Troca do Electron pelo Tauri

Fase 5 da [[Migração para Tauri]], pedida pelo usuário em 2026-11-13 ("pode fazer commit e avançar para a fase 5"). Completa a [[ADR-032 Migração para Tauri e Rust]] e a [[ADR-033 Sobreposição no Tauri]].

## Contexto

Depois da fase 4, o Eclipse em Tauri liga todos os serviços, mas ainda falta o que o Electron faz fora da lógica: os balões da bandeja, a segunda cópia que abre as contas da primeira, a opção "Iniciar com o Windows" e o Setup ([[ADR-030 Eclipse instalado por um Setup próprio]]). O app em Tauri também lê os cartões, as fontes e os `.ps1` pela pasta do projeto, gravada na compilação; instalado, essa pasta não existe.

O Eclipse em Electron já está instalado na máquina do usuário, em `%LOCALAPPDATA%\Programs\riot-account-manager`, com a chave de desinstalação `1cee5ad5-fb20-5488-b349-ffcaaa593158`, atalhos "Eclipse" no menu Iniciar e na Área de Trabalho e, se o usuário ligou, o valor `Eclipse` na chave `Run`. Os dois apps usam a mesma pasta de dados. Se rodassem juntos, os dois gravariam o mesmo `data.json`, vigiariam a mesma Riot e desenhariam duas sobreposições.

## Decisão

- **O Setup do Tauri substitui o do Electron.** NSIS por usuário (`currentUser`), sem administrador, em `%LOCALAPPDATA%\Eclipse`, em português e inglês. Antes de copiar os arquivos, se achar a chave de desinstalação do Electron, ele roda o desinstalador antigo em silêncio com `--updated`, como o próprio electron-builder faz ao instalar uma versão nova. Esse modo fecha o Eclipse antigo, apaga os arquivos e os atalhos dele e **mantém a pasta de dados e os valores de início com o Windows**. Depois de instalar, se o valor `Eclipse` da chave `Run` existia, ele passa a apontar para o novo `eclipse.exe` (o Tauri nomeia o executável pelo binário do Cargo); a aprovação em `StartupApproved\Run` fica como estava, então uma entrada desligada no Gerenciador de Tarefas continua desligada. Os ganchos ficam em `src-tauri/windows/hooks.nsh`.
- **Desinstalar o Tauri limpa o início com o Windows** (`Run` pelo próprio Tauri, `StartupApproved\Run` pelo gancho), menos numa atualização. A opção "apagar dados do app" do desinstalador do Tauri só apaga as pastas `Eclipse.AccountManager` (cache da WebView2), nunca `%APPDATA%\riot-account-manager`.
- **Os arquivos que o app lê vão no Setup, por uma lista fechada.** O `tauri.conf.json` leva os arquivos dos cartões, da caixa e da cobertura, as fontes usadas e os três `.ps1`, cada um no mesmo caminho relativo do projeto. No app compilado em modo release, a raiz do [[paths]] é a pasta do executável; em desenvolvimento, continua a do projeto. Um teste confere que tudo que o [[assetProtocol]] serve e todo `.ps1` usado vai no Setup, e que nada fora da lista vai.
- **Uma cópia por vez, e a segunda abre as contas.** O plugin oficial `tauri-plugin-single-instance` troca o mutex da fase 4. A segunda cópia avisa a primeira e sai; a primeira abre a Riot com as contas, como o `second-instance` do Electron, e só depois de terminar de iniciar. Os argumentos que a segunda cópia manda são ignorados.
- **O Tauri não abre com o Electron aberto.** Enquanto roda, o Electron segura o arquivo `lockfile` da pasta de dados, aberto para escrita e sem deixar outro processo escrever. Antes de tudo, o Eclipse em Tauri tenta abrir esse arquivo só para leitura, sem dividir a escrita; se o Windows recusar por estar em uso, o Electron está aberto, e o Eclipse mostra um aviso e sai. Não grava nada nem fecha nada. Conferido em 2026-11-13 com o Electron do usuário aberto pelo `npm start`: o Windows recusou. A janela de mensagens do Chromium (`Chrome_MessageWindow`) foi descartada, porque no Electron 44 ela não leva o caminho da pasta no título.
- **Os balões viram notificações do Windows.** O Tauri não mostra balões na bandeja. Os mesmos avisos do Electron (jogo que não abriu, login que precisa de atenção, erro da sobreposição) viram notificações do Windows pelo `tauri-winrt-notification`, sem som, com os mesmos textos limitados a 240 caracteres. Clicar abre as contas, como o clique no balão. O app instalado usa o identificador `Eclipse.AccountManager`, que o Setup grava no atalho; em desenvolvimento, as notificações aparecem em nome do PowerShell. Os textos são os já traduzidos, sem nome de conta nem senha.
- **"Iniciar com o Windows" na bandeja**, com a marca de ligado, só no app compilado em modo release, pelo [[startWithWindows]] em Rust, com o mesmo nome `Eclipse`.
- **A CSP do `tauri.conf.json` fica mínima** (`default-src 'none'`). Ela só vale para páginas `tauri://`, que o Eclipse não usa; os cartões vêm do `eclipse://` com a CSP do `cards.html`.
- **A remoção do Electron espera a conferência.** A tag no git e a remoção de `src/main`, `src/core` e do resto do Electron só acontecem depois de o usuário abrir o app em Tauri na Riot real e aprovar. Até lá, `npm start` e `npm run dist` continuam funcionando. **Revisão de 2026-11-15:** o usuário pediu a remoção e a instalação antes de conferir, para abrir o Eclipse por um atalho. Feitas com a tag `electron-final` e a versão 2.0.0 ([[Migração para Tauri]]); voltar ao Electron é sair da tag.

## Alternativas consideradas

- **Deixar o usuário desinstalar o Electron à mão.** Fica fácil esquecer, e os dois apps abririam juntos no mesmo `data.json`.
- **Desinstalar o Electron sem `--updated`.** O desinstalador antigo apagaria os valores de início com o Windows, e a aprovação do Gerenciador de Tarefas se perderia.
- **Balão de verdade pelo `Shell_NotifyIcon`.** O ícone da bandeja é do Tauri, sem acesso ao identificador dele; um segundo ícone só para os balões apareceria na bandeja.
- **Levar a pasta `node_modules/@fontsource` inteira.** São quase 6 MB para usar quatro pesos.
- **Manter o mutex próprio.** Não tem como avisar a primeira cópia.

## Consequências

- O Setup do Tauri mexe na instalação do Electron, mas só quando o usuário roda o Setup. Nada disso foi rodado nesta máquina: o Setup foi só compilado.
- O desinstalador antigo, em `--updated`, fecha qualquer `Eclipse.exe` do usuário, sem distinguir maiúsculas, então fecharia também o `eclipse.exe` do Tauri. Isso só acontece enquanto a chave do Electron existe, ou seja, na primeira instalação, quando o único aberto pode ser o Electron.
- O app instalado depende dos arquivos ao lado do executável. Uma página nova nos cartões que carregue um arquivo fora da lista quebra o teste do Setup, não o usuário.
- Duas bibliotecas novas: `tauri-plugin-single-instance` (oficial do Tauri) e `tauri-winrt-notification` (a mesma que o plugin de notificação do Tauri usa).

## Relacionado

- [[Arquitetura]]
- [[Segurança e privacidade]]
- [[Migração para Tauri]]
- [[ADR-030 Eclipse instalado por um Setup próprio]]
- [[startWithWindows]] · [[paths]] · [[main]] · [[assetProtocol]]
