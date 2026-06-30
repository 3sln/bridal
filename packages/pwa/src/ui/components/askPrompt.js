// Prompt shown when the agent asks the user something (MCP `ask` tool). Answer
// by tapping a choice, speaking (handled upstream), or typing. Emits `answer-ask`.
import { dd } from '../../runtime.js';

const { alias, div, p, button } = dd;

export default alias(function (ask) {
  const self = this;
  const answer = (a) => self.dispatchEvent(new CustomEvent('answer-ask', { bubbles: true, detail: { answer: a } }));

  return div({ className: 'ask' },
    p({ className: 'ask-q' }, ask.question),
    ask.choices && ask.choices.length
      ? div({ className: 'ask-choices' },
          ask.choices.map((c, i) => button({ className: 'btn' }, `${i + 1}. ${c}`).on({ click: () => answer(c) }).key(c)),
        )
      : p({ className: 'hint' }, 'Speak or type your answer.'),
  );
});
