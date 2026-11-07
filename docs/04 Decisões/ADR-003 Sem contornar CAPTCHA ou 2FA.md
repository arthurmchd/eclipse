---
tipo: decisão
status: aceita
data: 2026-10-26
tags: [adr, segurança, login]
---

# ADR-003 Sem contornar CAPTCHA ou 2FA

## Contexto

O login automático encontra telas que pedem uma pessoa: CAPTCHA, 2FA por e-mail, aceite de termos, verificação de idade, verificação coreana, Riot ID ambíguo. Tentar resolver ou repetir essas etapas automaticamente pode bloquear a conta e viola o propósito delas.

## Decisão

O app nunca tenta contornar essas etapas. Quando aparecem:

1. o fluxo para e marca a operação com `needsAttention`;
2. o painel oferece **Show Riot Client**, que abre a janela que contém o desafio, preservando o contexto;
3. depois que o usuário conclui, o monitor volta a esconder o cliente.

Desde 2026-11-07 não há botão nem monitor: a Riot já está visível, a cobertura da coluna de login sai, e o usuário conclui o desafio na própria tela da Riot ([[ADR-024 Coluna de login coberta durante o login]], [[ADR-028 Modo antigo removido]]). A regra não muda.

Regras derivadas:

- Uma tela de verificação desconhecida nunca recebe senha automática.
- CAPTCHA **antes** da submissão usa o renderer nativo do Riot (é a primeira submissão, não um reenvio).
- CAPTCHA **depois** da submissão pede intervenção e não reenvia.
- Falha de senha, rede ou limite de tentativas não é repetida pela digitação.
- Nunca digitar credenciais sobre um desafio pendente, mesmo que ele expire.

## Consequências

- Algumas trocas de conta exigem ação manual.
- Erros comuns não podem abrir a tela de login sozinhos; a pessoa decide quando abrir.

## Relacionado

- [[riotAuthentication]] · [[signInFlow]] · [[Fluxo de login]]
