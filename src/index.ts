/**
 *	@license Apache-2.0
 *	Copyright 2016 - present The Midicast Authors. All Rights Reserved.
 *	Modifications copyright (C) 2017 <Nathan L Spaeth nathan@spaeth.nl>
 *
 *	Licensed under the Apache License, Version 2.0 (the "License"); you may not
 *	use this file except in compliance with the License. You may obtain a copy
 *	of the License at
 *
 *			http://www.apache.org/licenses/LICENSE-2.0
 *
 *	Unless required by applicable law or agreed to in writing, software
 *	distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 *	WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 *	License for the specific language governing permissions and limitations
 *	under the License.
 */

import { adapt } from '@cycle/run/lib/adapt'
import xs, { Listener, Producer, Stream, Subscription } from 'xstream'

export type Window = browser.windows.Window
type Tab = browser.tabs.Tab

export type IMessagesDriver = (message$: Stream<IMessage>) => Stream<IMessage>
export type IMessagesSource = Stream<IMessage>
export interface IMessagesSink {
	messages: Stream<IMessage>
}

type Port = browser.runtime.Port

/**
 * Creates a Cycle.js driver to send and receive messages in a WebExtension.
 *
 * The WebExtension messaging API is asymmetric: the long-running background
 * page awaits connections while ephemeral popup and content scripts initiate
 * them.	Thus, set `shouldInitiate` to `true` unless `messagesDriver` is for a
 * background page.
 */
export function makeMessagesDriver({ shouldInitiate }: { shouldInitiate: boolean }): IMessagesDriver {
	/**
	 * Accepts a stream of messages to send on the channel and returns a stream of
	 * responses received on the channel.
	 */
	return (outgoingMessage$: Stream<IMessage>): Stream<IMessage> => {
		let channels: Port[] = []
		let outgoingSubscription: Subscription
		let observer: Listener<IMessage>

		function forwardMessage(incomingMessage: IMessage) {
			observer.next(incomingMessage)
		}

		const outgoingMessageListener = {
			next: (outgoingMessage: IMessage) => {
				try {
					channels.map(channel => channel.postMessage(outgoingMessage))
				} catch (error) {
					// console.warn(error)
					// console.warn('Failed to send message', outgoingMessage)
				}
			},
			error: () => { }, // TODO: What should be done here?
			complete: () => { }, // TODO: What should be done here?
		}

		function connectToChannel(newChannel: Port) {
			if (channels.includes(newChannel)) { return }
			if (channels.length === 0) {
				outgoingSubscription = outgoingMessage$.subscribe(outgoingMessageListener)
			}

			channels = [...channels, newChannel]
			newChannel.onMessage.addListener(forwardMessage)
			// console.log('Connected to: ', channel)
			newChannel.onDisconnect.addListener(
				(port: Port) => {
					// console.log('Disconnecting from : ', channel)
					// TODO: update typing for onMessage.removeListener
					(newChannel as any).onMessage.removeListener(forwardMessage)
					channels = channels.reduce(
						(acc: Port[], channel) =>
							channel === newChannel ? acc : acc.concat(channel),
						[])
					if (channels.length === 0) { outgoingSubscription.unsubscribe() }
				},
			)
		}

		const incoming$: Stream<IMessage> = xs.create({
			start: listener => {
				observer = listener
				if (shouldInitiate) {
					connectToChannel(browser.runtime.connect())
				} else {
					browser.runtime.onConnect.addListener(connectToChannel)
				}
			},
			stop: () => {
				outgoingSubscription.unsubscribe()
				channels.map(channel => channel.disconnect())
			},
		})

		return adapt(incoming$ as any)
	}
}

export interface IMessage {
	type: string
	payload: any
}

type IListenerGetter = () => Listener<IMessage>

type IHandler = (...payload: any[]) => void
interface IHandlers {
	[k: string]: IHandler
}
type IcreateOutgoingHandlers = (getter: IListenerGetter) => IHandlers
type IcreateIncomingHandlers = (listener: Listener<IMessage>) => void
function createAPIDriver(createOutgingHandlers: IcreateOutgoingHandlers,
	                        createIncomingHandlers: IcreateIncomingHandlers) {
/**
 * Accepts a stream of messages to send on the channel and returns a stream of
 * responses received on the channel.
 */
	return (updateCommands$: Stream<IMessage>): Stream<IMessage> => {
		let outgoingSubscription: Subscription
		let observer: Listener<IMessage>

		const outgoingHandlers = createOutgingHandlers(() => observer)
		outgoingSubscription = updateCommands$.subscribe({
			next: (update: IMessage) => {
				const { type, payload } = update
				if (outgoingHandlers[type]) { outgoingHandlers[type](...payload) }
			},
			error: () => { /* TODO: ?? */ },
			complete: () => { /* TODO: ?? */ },
		})

		const incoming$: Stream<IMessage> = xs.create({
			start: (listener: Listener<IMessage>) => { createIncomingHandlers(listener) },
			stop: () => { outgoingSubscription.unsubscribe() },
		})

		return adapt(incoming$ as any)
	}
}

export type IWindowDriver = (windows$: Stream<IMessage>) => Stream<IMessage>
export type IWindowSource = Stream<IMessage>
export type IWindowSink = Stream<Window>

export function makeWindowDriver({ createListeners }: { createListeners: boolean }): IWindowDriver {
	const getAll = (listener: Listener<IMessage>) => browser.windows.getAll(
		{ populate: true }).then((...payload: any[]) =>
			listener.next({
				type: 'allWindows',
				payload,
			}))
	const createOutgingHandlers = (getListener: IListenerGetter) => ({
		getAll: (...payload: any[]) => getAll(getListener()),
		create: browser.windows.create,
		remove: browser.windows.remove,
		update: browser.windows.update,
	})

	const createIncomingHandlers = (listener: Listener<IMessage>) => {
		const handlers = [ 'onFocusChanged', 'onRemoved' ]
			.map(event => ({ [event]: (...payload: any[]) => listener.next(newMessage(event, payload)) }))
		const events = Object.assign({}, ...handlers)

		// The on browser.windows.onCreated event does not automatically
		// populate the 'tabs' property. Do that manually here in order
		// to make the Window object more consistent
		events.onCreated = (window: browser.windows.Window) =>
			browser.tabs.query({ windowId: window.id })
			.then(
					(tabs: browser.tabs.Tab[]) => listener.next(newMessage('onCreated', [{ ...window, tabs }])),
				)

		Object.entries(events)
			.map(([event, handler]) => (browser as any).windows[event].addListener(handler))
		getAll(listener)
	}
	return createAPIDriver(createOutgingHandlers, createIncomingHandlers)
}

export type ITabDriver = (windows$: Stream<IMessage>) => Stream<IMessage>
export type ITabSource = Stream<IMessage>
export type ITabSink = Stream<IMessage>

interface IattachInfo {
	newWindowId: number
	newPosition: number
}

interface IdetachInfo {
	oldWindowId: number
	oldPosition: number
}
const tabEvents = [
	'onCreated',
	'onUpdated',
	'onMoved',
	'onSelectionChanged',
	'onActiveChanged',
	'onActivated',
	'onHighlightChanged',
	'onHighlighted',
	'onDetached',
	'onAttached',
	'onRemoved',
	'onReplaced',
	'onZoomChange',
]
export function makeTabDriver({ createListeners }: { createListeners: boolean }): ITabDriver {
	const createOutgingHandlers = (getListener: IListenerGetter) => ({
		connect: browser.tabs.connect,
		sendMessage: browser.tabs.sendMessage,
		create: browser.tabs.create,
		duplicate: browser.tabs.duplicate,
		update: browser.tabs.update,
		move: browser.tabs.move,
		reload: browser.tabs.reload,
		remove: browser.tabs.remove,
		executeScript: browser.tabs.executeScript,
		insertCSS: browser.tabs.insertCSS,
		setZoom: browser.tabs.setZoom,
		setZoomSettings: browser.tabs.setZoomSettings,
	})

	const createIncomingHandlers = (listener: Listener<IMessage>) => {
		const handlers = tabEvents
			.map(event => ({
				[event]: (...payload: any[]) => listener.next(newMessage(event, payload)),
			}),
		)
		const events = Object.assign({}, ...handlers)

		Object.entries(events)
			.map(([event, handler]) => (browser as any).tabs[event].addListener(handler))
	}
	return createAPIDriver(createOutgingHandlers, createIncomingHandlers)
}

export type MessageType = string // 'app' | 'tabs' | 'windows'
export function newMessage(type: MessageType | MessageType[], payload?: any): IMessage {
	if (Array.isArray(type)) {
		if (type.length === 0) { throw new Error('Must provide a type') }
		const [thisType, ...types] = type
		return {
			type: thisType,
			payload: types.length === 0 ? payload : newMessage(types, payload),
		}
	}

	return { type, payload }
}

export function pickType(message$: Stream<IMessage>, type: string) {
	return message$
		.filter(msg => msg.type === type)
		.map(msg => msg.payload)
}
