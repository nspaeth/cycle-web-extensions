# `cycle-web-extensions` #

Cycle.js drivers to use in Chrome extensions and WebExtensions.

Forked from [cycle-extensions](https://github.com/appsforartists/midicast/tree/develop/packages/cycle-extensions) to rewrite it with xstream. Additionally support for the `tabs` and `windows` APIs was added, and the `MessagesDriver` now supports more than one simultaneous connection.

## Drivers ##

- [`MessagesDriver`](#MessagesDriver)
- [`WindowsDriver`](#WindowsDriver)
- [`TabsDriver`](#TabsDriver)


### `MessagesDriver` ###

In the Web Extension architecture, logic and state both live in a long-running background page.  The user interface lives in a separate page called a popup.  The two pages communicate by passing messages between each other.  The background page awaits connections; the popup initiates them.

`messagesDriver` accepts a stream of messages to send to the other page and returns a stream of messages received from the other page.

`makeMessagesDriver` takes a single named argument, `shouldInitiate`.  Set it to `false` in the background page and `true` in any other pages.

Here's an example of a simple counter.  Notice that when the popup opens, it sends a request for the current state to the background page.  The response it receives creates the first frame of DOM.

```javascript
import { run } from '@cycle/run'
import xs from 'xstream'
import sampleCombine from 'xstream/extra/sampleCombine'

import {
	makeMessagesDriver,
	newMessage,
	pickType,
} from 'cycle-web-extensions'

function Background({ messages: messages$ }) {
	const initialState = { count: 0 }

	const state$ = messages$.reduce(
		(state, message) => {
			if (message.type === 'increment') { return { ...state, count: state.count + 1 } }
			if (message.type === 'decrement') { return { ...state, count: state.count - 1 } }
			return state
		},
		initialState,
	)

	return {
		messages: xs.merge(
			state$.map(state => newMessage(['state_changed', state])),
			pickType(messages$, 'current_state_requested')
				.compose(sampleCombine(state$))
				.map(([, state]) => newMessage(['state_changed'], state))
			),
	}
}

run(
	Background,
	{ messages: makeMessagesDriver({ shouldInitiate: false }) },
)

// and in your popup script
import {
	makeMessagesDriver,
	newMessage,
} from 'cycle-web-extensions'
import { button, div } from 'hyperscript-helpers'

function Popup({ DOM, messages: messages$ }) {
	const count$ = pickType(messages$, 'state_changed')
		.map(payload => payload.count) // Why no pluck in xstream?

	return {
		messages: xs.merge(
			DOM.select('.increment').events('click').mapTo(newMessage(['increment'])),
			DOM.select('.decrement').events('click').mapTo(newMessage(['decrement'])),
		).startWith(newMessage('current_state_requested')),
		DOM: count$.map(
			count => (
				div([
					`The count is now ${count}.`,
					div([button('.decrement', ['-1']), button('.increment', ['+1'])]),
				])
			),
		),
	}
}

function intent(DOM) {
	const increment$ = DOM.select('.increment').events('click')
		.mapTo(newMessage(['increment']))
	const decrement$ = DOM.select('.decrement').events('click')
		.mapTo(newMessage(['decrement']))

	return {
		messages: xs.merge(increment$, decrement$)
			.startWith(newMessage(['current_state_requested'])),
	}
}

run(
	Popup,
	{
		DOM: makeDOMDriver('#root'),
		messages: makeMessagesDriver({ shouldInitiate: true }),
	},
)
```

### `WindowsDriver` ###

* *TODO:* Document this

### `TabsDriver` ###

* *TODO:* Document this

To see a real extension written with these drivers, check out [nspaeth/tab-manager](https://github.com/nspaeth/tab-manager).

## Installation ##

```
yarn add cycle-web-extensions
```

## License ##

[Apache 2.0](http://www.apache.org/licenses/LICENSE-2.0)
