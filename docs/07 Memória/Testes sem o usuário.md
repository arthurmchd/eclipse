---
tipo: memória
categoria: preferência
criada: 2026-11-13
atualizada: 2026-11-20
tags: [memória, testes]
---

# Testes sem o usuário

Para testar o Eclipse sem o usuário, o agente usa só capturas de tela pelo PowerShell limitadas às janelas do próprio Eclipse. O usuário recusou o controle da tela inteira (computer use), uma Riot falsa para testes e o Playwright pelo CDP do WebView2.

**Por quê:** escolha do usuário em 2026-11-13, na [[Migração para Tauri]]. Ele já preferia não ter a tela capturada (Changelog de 2026-11-08) e quer o mínimo de ferramentas.

**Como aplicar:** conferir o visual capturando só janelas do Eclipse, nunca a janela da Riot nem a área de trabalho inteira. O resto vai por testes com dependências falsas injetadas. Pedir antes de qualquer conferência na Riot real.

Exceção pontual: em 2026-11-20 o usuário autorizou, só para as capturas do README, abrir uma cópia de teste com contas fictícias e capturar a janela da Riot na tela de login ([[Publicar no GitHub#Capturas do README]]). A autorização não vale para outras vezes.

Exceção pontual: em 2026-11-21 o usuário autorizou, para medir a velocidade do login, testes na Riot real com login e League aberto, numa cópia temporária da pasta de dados e só com contas sem 2FA. Também vale só para aquela medição.

Exceção pontual: ainda em 2026-11-21 o usuário autorizou reproduzir na Riot real o login travado com a conta já conectada, nas mesmas condições (cópia temporária dos dados, só contas sem 2FA, Eclipse instalado fechado durante o teste). Vale só para aquela reprodução.

Exceção pontual: ainda em 2026-11-21 o usuário autorizou testar na Riot real o preenchimento por UI Automation da 2.18.0, nas mesmas condições. O agente também preencheu e apagou um valor fictício no campo de usuário, sem enviar, para achar a falha. Vale só para aquele teste.

Exceção pontual: ainda em 2026-11-21 o usuário pediu "faça todos os testes que falou" para conferir a 2.19 na Riot real: o `riot_check` e logins com contas sem 2FA, numa cópia temporária dos dados, com o Eclipse instalado fechado. Vale só para aquela conferência.

## Relacionado

- [[Memória]]
- [[Desenvolvimento]]
