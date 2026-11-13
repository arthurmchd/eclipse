---
tipo: módulo
arquivo: src-tauri/src/application/timers.rs
camada: aplicação
testes: src-tauri/tests/application/timers.rs
tags: [módulo, tauri]
---

# timers

> O `setTimeout` dos serviços em Rust: agenda uma tarefa para daqui a alguns milissegundos e permite cancelá-la.

## Responsabilidade

- Dar ao [[signInService]], [[sessionKeeper]], [[riotWakeup]] e [[rankWatcher]] um jeito de esperar sem bloquear quem chamou.
- **Não** existe no Electron: lá o Node já tem `setTimeout`. Nasceu na fase 3 da [[Migração para Tauri]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `Timers` | trait | `later(ms, tarefa)` devolve um número; `cancel(número)` desiste dela |
| `ThreadTimers` | struct | O temporizador real |
| `Task` | tipo | `Box<dyn FnOnce() + Send>` |

## Dependências

- Usa: só a biblioteca padrão.
- Usado por: [[signInService]], [[sessionKeeper]], [[riotWakeup]], [[rankWatcher]].

## Invariantes e decisões

- **Uma thread espera, cada tarefa roda na sua.** O `ThreadTimers` tem uma thread que dorme até a próxima tarefa vencer e a solta numa thread nova. Assim uma tarefa lenta (um login, uma conversa com a Riot) não atrasa as outras, como acontece no Node, onde cada `await` libera o laço.
- **Cancelar antes de vencer basta.** `cancel` tira a tarefa da fila; uma que já começou segue até o fim, como no `clearTimeout`.
- **Soltar o temporizador descarta o que faltava.** Ao ser destruído, ele para a thread e joga fora as tarefas pendentes.
- **Os serviços nunca chamam `later` segurando a trava de outra pessoa.** A tarefa só roda depois, em outra thread; os testes trocam o `ThreadTimers` por um temporizador manual que roda cada tarefa quando o teste pede, como os `setTimeout` falsos dos testes JS.

## Testes

`src-tauri/tests/application/timers.rs` confere a ordem pelos prazos, o cancelamento, que uma tarefa lenta não segura a seguinte e que o temporizador destruído não roda mais nada. O temporizador manual fica em `src-tauri/tests/application.rs`.

## Pontos de atenção

- Cada tarefa vencida cria uma thread. Os serviços agendam poucas (no máximo uma a cada segundo), então isso não pesa; se um dia agendarem muitas, trocar por um conjunto fixo de threads.
