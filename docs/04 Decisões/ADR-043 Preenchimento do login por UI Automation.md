---
tipo: decisão
status: aceita
data: 2026-11-21
tags: [adr, segurança, login, desempenho]
---

# ADR-043 Preenchimento do login por UI Automation

## Contexto

O [[loginForm]] preenche o formulário da Riot com mensagens postadas só para a janela dela: clica no campo, apaga com `End` e 256 `Backspace` e digita um `WM_CHAR` a cada 35 ms, porque o Chromium perde caracteres postados mais rápido. No [[Laboratório de velocidade do login]] isso levou 6,9 s do formulário pronto até o envio. Preencher pelos campos de texto que a própria janela expõe ao UI Automation (`ValuePattern.SetValue`) levou 0,3 s, com a Riot autorizando o login nas 3 tentativas de cada variante, em torno de 2,5 s depois do envio, igual ao script atual.

A regra da [[Segurança e privacidade]] dizia que o preenchimento manda mensagens só para a janela do Riot. O UI Automation é outro canal até a mesma janela, então esta decisão muda o texto da regra.

## Decisão

O `login.ps1` tenta primeiro o UI Automation, partindo só do HWND da Riot que ele já acha e confere: dentro dessa janela, procura por até 3 s os campos de texto habilitados e editáveis que pertencem a um processo da Riot. Só segue se houver exatamente um campo de senha e exatamente um outro campo. Preenche a senha, depois o usuário, e espera até 1,5 s o usuário aparecer igual ao pedido. Qualquer outra situação (campos ausentes, a mais, erro do UI Automation ou usuário diferente do pedido) cai na digitação por mensagens de antes, que limpa os campos e digita de novo. A caixa "Stay signed in" e o clique em entrar continuam iguais. O script diz qual caminho usou (`input:uia` ou `input:keys`) e o [[signInFlow]] grava isso no `sign-in.log`.

## Revisão de 2026-11-21: teste na Riot real

Com autorização do usuário, a 2.18.0 foi testada na Riot real (6 logins com League, contas sem 2FA, cópia temporária dos dados): todos entraram, mas os 6 caíram em `input:keys`. Duas causas:

- **O valor chega depois.** O Chromium aplica o `SetValue` de forma assíncrona: lido na hora, o campo vinha vazio; 200 ms depois, igual ao pedido. A conferência imediata sempre falhava. Agora a senha vai primeiro e o usuário por último, e o script espera o usuário aparecer. O Chromium aplica os pedidos na ordem, então o usuário certo indica que a senha também já foi aplicada, sem ler a senha de volta.
- **O campo de busca do Eclipse aparece dentro da janela da Riot.** O UI Automation lista o "Search accounts" dos cartões como descendente da janela da Riot, num processo do WebView2. Com o Eclipse aberto, eram três campos e o script desistia. Agora só contam campos de processos `Riot Client` ou `RiotClientUx`, o que também impede escrever num campo do próprio Eclipse.

No reteste com a correção (2.18.1), os 6 logins usaram `input:uia`. Do formulário ao envio caiu de 8,2 s para 4,1 s, e o total de cerca de 42 s para cerca de 37,5 s com a Riot na tela de login. O ganho real é de cerca de 4 s, não 6: no laboratório o helper já estava aberto, e o tempo de abrir o PowerShell não entrava na conta.

## Alternativas consideradas

- **Digitar mais rápido por mensagens:** com 12 ms por caractere e sem limpar, o envio caiu para cerca de 3,5 s, mas o próprio motivo dos 35 ms é que o Chromium perde caracteres. Uma senha incompleta vira uma tentativa errada na Riot.
- **Enviar com Enter em vez do clique:** economiza cerca de 0,8 s no laboratório, mas a variante testada pulava a caixa "Stay signed in", e depois de clicar na caixa o foco sai do campo de senha. Fica para depois, se valer a pena medir.
- **Só UI Automation, sem recuo:** um tema futuro da Riot, ou o UI Automation indisponível, quebraria o login de vez.
- **Deixar como está:** cerca de 6 s a mais em todo login com senha.

## Consequências

- O login com senha chega ao envio cerca de 4 s antes quando o UI Automation acha os campos (medido na Riot real em 2026-11-21).
- Continua sem teclado global, sem mouse do usuário e sem injeção de código. O UI Automation só lê e escreve campos dentro da janela da Riot já conferida pelo processo; nada sai dela, e o valor do usuário só é comparado dentro do script.
- **Foco:** numa janela WPF de teste, o `SetValue` trouxe a janela para a frente; só ler os campos não trouxe. Não deu para conferir se o Chromium da Riot faz o mesmo sem usar a Riot real. No caso normal isso não muda nada, porque o [[signInFlow]] já traz a Riot para a frente no começo de todo login (`reveal`). Se o usuário trocar de janela nos poucos segundos até o preenchimento, a Riot pode voltar para a frente, o que a digitação por mensagens não fazia.
- Ao ser consultado pelo UI Automation, o Chromium da Riot liga a acessibilidade e a mantém ligada enquanto estiver aberto, com algum custo de memória e processamento na janela da Riot.
- A ação `type` continua sem teste automatizado, porque precisa da janela real. A escolha dos campos é testada no `self-test`.
- Se a Riot mudar o formulário, o recuo para as mensagens mantém o login funcionando no tempo antigo, e o `sign-in.log` mostra `input:keys`.

## Relacionado

- [[loginForm]]
- [[signInFlow]]
- [[Segurança e privacidade]]
- [[Laboratório de velocidade do login]]
