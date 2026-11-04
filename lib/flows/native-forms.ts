/**
 * A WhatsApp form's life: a draft until Meta publishes it, then immutable, then retired
 * ("DEPRECATED" on Meta) once nothing may send it any more. The builder, the form designer
 * and the forms list all read a form's state from here.
 */
export interface NativeFormState {
  status?: string | null
  flow_id_meta?: string | null
}

/** Published on Meta, with the Meta Flow ID the runtime sends. */
export function isFormPublished(form: NativeFormState | null | undefined): boolean {
  return form?.status === 'PUBLISHED' && Boolean(form.flow_id_meta)
}

/** Retired on Meta: it can no longer be sent, edited or published, only deleted here. */
export function isFormRetired(form: NativeFormState | null | undefined): boolean {
  return form?.status === 'DEPRECATED'
}

/**
 * The forms a flow block may pick: every form that is not retired, plus the retired one the
 * block already uses, so the choice stays visible (and flagged) until it is changed.
 */
export function listSelectableForms<T extends NativeFormState & { id: string }>(forms: T[], selectedId?: string | null): T[] {
  return (Array.isArray(forms) ? forms : []).filter(form => !isFormRetired(form) || form.id === selectedId)
}
