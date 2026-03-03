import { useCallback, useEffect, useRef, useState } from "react"

export function useScrollFlashTarget(durationMs = 1600) {
  const targetRef = useRef<HTMLDivElement | null>(null)
  const shouldFocusRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const [isFlashing, setIsFlashing] = useState(false)

  const scrollIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      targetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [])

  const triggerFlash = useCallback(() => {
    setIsFlashing(true)
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setIsFlashing(false)
      timerRef.current = null
    }, durationMs)
  }, [durationMs])

  const requestFocus = useCallback(() => {
    shouldFocusRef.current = true
    setIsFlashing(false)
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cancelFocus = useCallback(() => {
    shouldFocusRef.current = false
  }, [])

  const focusNow = useCallback(() => {
    shouldFocusRef.current = false
    scrollIntoView()
    triggerFlash()
  }, [scrollIntoView, triggerFlash])

  const consumePendingFocus = useCallback((enabled: boolean) => {
    if (!enabled || !shouldFocusRef.current) {
      return
    }
    focusNow()
  }, [focusNow])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return {
    targetRef,
    isFlashing,
    requestFocus,
    cancelFocus,
    consumePendingFocus,
  }
}
