---
tipo: decisão
status: substituída
data: 2026-10-27
tags: [adr, arquitetura, interface, segurança]
---

# ADR-007 Interface completa dentro do Riot Client

> Substituída em 2026-11-07 pela [[ADR-028 Modo antigo removido]]. A view de contas dentro da cópia privada saiu; os cartões sobre a Riot oficial ([[ADR-009 Sobreposição no cliente oficial]]) são a única interface.

## Contexto

O seletor MINHAS CONTAS já aparece na cópia privada da interface Riot, mas cadastro, edição, configurações e consulta de elos ainda abrem a janela independente Riot Account Manager. O usuário pediu retirar essa janela e usar todas as funções dentro do Riot Client, preservando suas alterações recentes no login e no monitor Windows.

## Decisão

O processo principal passa a executar somente os serviços, armazenamento criptografado, atualização de elos, login e bandeja. A interface completa existente é hospedada como um `WebContentsView` dentro da mesma `BrowserWindow` da cópia privada do Riot. Um acesso **Contas** permanece disponível no login e na página conectada; voltar ao Riot remove a visualização de contas sem criar outra janela.

A visualização possui preload próprio, `contextIsolation`, sandbox e Node desabilitado. Suas chamadas IPC aceitam apenas o `webContents` e o frame principal da visualização que carregou o arquivo local esperado. O addon principal encaminha comandos limitados à ponte local autenticada; o token da ponte continua fora dos renderers. O serviço de contas valida métodos e argumentos e publica eventos públicos em uma fila limitada.

Cadastro e edição necessariamente recebem os valores que o próprio usuário digita na visualização. Esses valores transitórios são enviados ao serviço; senhas, sessões e chaves já armazenadas nunca são devolvidas para preencher os campos. Copiar senha continua escrevendo somente na área de transferência pelo processo principal, com limpeza temporizada. Chaves existentes aparecem mascaradas.

## Alternativas consideradas

- **Manter a janela independente escondida e abri-la em Gerenciar contas.** Contraria a experiência unificada solicitada.
- **Colocar o formulário completo no DOM da página Riot.** Mistura estilos, atalhos e campos de cadastro com a interface do fornecedor e amplia o acesso do renderer Riot a comandos de gerenciamento.
- **Iframe com origem compartilhada ou CSP relaxada.** A separação fica dependente da página Riot; o `WebContentsView` permite preload, sandbox e validação de remetente próprios, sem mudar a CSP do Riot.
- **Mover o armazenamento e as chaves para o host da interface Riot.** Acopla dados ao processo que desaparece durante trocas de conta e amplia a exposição de segredos.

## Consequências

- Cadastro, edição, exclusão, filtros, elos, configurações, atualização, cópia e progresso continuam na mesma interface funcional, agora dentro da janela Riot.
- O armazenamento conserva o diretório e formato existentes. Não há migração automática de credenciais nem gravação na instalação Riot.
- A ponte passa a aceitar comandos de gerenciamento validados. O limite de corpo dessa rota deve acomodar os formulários, com tamanho máximo explícito, e respostas/eventos continuam sem segredos persistidos.
- A abertura padrão passa a usar o modo integrado. Sem uma cópia privada compatível, o aplicativo apresenta um erro recuperável; não recria a janela independente como substituta silenciosa.
- A visualização de contas é um filho nativo da janela Riot. Fechá-la não encerra o serviço nem uma operação de login em andamento.
- CAPTCHA, 2FA e recuperação da interface nativa continuam seguindo o fluxo existente. Esta decisão não modifica as alterações locais de [[signInFlow]] e [[windowController]].

## Relacionado

- [[Arquitetura]] · [[Integração com o Riot Client]] · [[Segurança e privacidade]]
- [[ADR-001 Cópia privada da interface do Riot]] · [[ADR-002 Segredos protegidos pelo DPAPI]]
- [[main]] · [[bridgeServer]] · [[managerService]] · [[managerHost]] · [[manager-preload]] · [[renderer]]
