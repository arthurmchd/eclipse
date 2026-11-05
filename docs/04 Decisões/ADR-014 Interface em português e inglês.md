---
tipo: decisão
status: aceita
data: 2026-11-04
tags: [adr, arquitetura, interface]
---

# ADR-014 Interface em português e inglês

## Contexto

O usuário pediu, em 2026-11-04, uma opção nas Configurações para escolher entre inglês e português, com o Eclipse inteiro adaptado às duas línguas e português como padrão. Até então os textos estavam espalhados: a interface dos cartões e a bandeja em português, e as mensagens do login em inglês, que vinham do [[signInFlow]] e do [[signInService]] e apareciam em balões.

## Decisão

O idioma é uma configuração salva (`language`, `pt` ou `en`, padrão `pt`) no [[store]]. As mensagens do processo principal continuam escritas em inglês no código e no `sign-in.log`, e são traduzidas só na hora de mostrar, pelo catálogo do [[language]]. Os cartões têm um dicionário próprio, `src/renderer/cardsText.js`, porque o renderer usa ES modules sem build e não pode importar o módulo CommonJS do main.

## Alternativas consideradas

- **Traduzir dentro de cada módulo que gera a mensagem:** espalharia o idioma por [[signInFlow]], [[riotAuthentication]] e outros, e o log passaria a mudar de língua conforme a configuração. Ler um `sign-in.log` de diagnóstico ficaria mais difícil.
- **Um só dicionário para main e renderer:** exigiria build ou um arquivo servido aos dois formatos de módulo. O projeto não tem build.
- **Idioma pelo sistema operacional:** o usuário pediu português por padrão e escolha manual.

## Consequências

- O log fica sempre em inglês e o diagnóstico não depende do idioma escolhido.
- Mensagem nova que chega ao usuário precisa entrar no catálogo do [[language]] (par inglês e português). Sem par, aparece como foi escrita, sem erro; o teste do catálogo confere que cada par traduz nos dois sentidos sem ambiguidade.
- Texto novo nos cartões precisa existir nas duas línguas em `cardsText.js`; o teste Electron dos cartões troca para inglês e confere os textos principais.
- A troca vale na hora: os cartões aplicam a resposta de `saveSettings`, e o main refaz o menu da bandeja e avisa a caixa "Ocultar contas" ([[overlayToggle]]).
- Fica de fora o renderer legado do modo privado ([[renderer]]), os textos injetados na cópia privada da interface Riot e as mensagens dos scripts `.bat`. Os nomes de jogos, de regiões e "Riot API (League)" não mudam.

## Relacionado

- [[Arquitetura]]
- [[cards]]
- [[main]]
