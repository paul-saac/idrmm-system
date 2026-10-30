/** Visual required-field marker; controls retain their existing validation. */
export function RequiredMark() {
  return <span aria-hidden="true" className="ml-0.5 text-red-500">*</span>;
}
