import { useSyncExternalStore } from 'react'
import { store, type Snapshot, type TallyStore } from '../db/store'
import { getTick, subscribeToTick } from './ticker'

export const useSnapshot = (): Snapshot =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

export const useStore = (): TallyStore => store

/** Re-renders once a second. Only call it where a running timer is on screen. */
export const useNow = (): number => useSyncExternalStore(subscribeToTick, getTick, getTick)
