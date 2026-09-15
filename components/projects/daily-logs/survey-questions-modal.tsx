"use client";

import { startTransition, useActionState, useEffect, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  saveSurveyQuestions,
  type SurveyQuestionsActionState,
} from "@/lib/daily-logs/actions";
import type { SurveyQuestion } from "@/lib/daily-logs/data";

const initialState: SurveyQuestionsActionState = {};

type QuestionDraft = {
  /** The existing question's id, or null for one added in this same
   * session — saveSurveyQuestions inserts a null-id row and updates
   * everything else, same convention as every other list-editing action
   * in this app. */
  id: number | null;
  questionText: string;
  isRequired: boolean;
};

function toDrafts(questions: SurveyQuestion[]): QuestionDraft[] {
  return questions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    isRequired: q.isRequired,
  }));
}

/**
 * A project's Survey questions, editable by an admin here — the single
 * source of truth for every question a Daily Log for this project asks,
 * including the three every project starts with (accidents/schedule
 * delays/weather delays, seeded by seedDefaultSurveyQuestions when the
 * project is created) alongside anything added by hand. See
 * 0033_daily_log_survey_questions.sql and
 * 0034_daily_log_survey_defaults.sql. Nothing is written until Save;
 * Cancel just discards this session's edits and re-derives from
 * `questions` next time the modal opens (Modal itself unmounts children
 * on close, so this component's own state is naturally fresh each time).
 */
export function SurveyQuestionsModal({
  projectId,
  questions,
  open,
  onClose,
}: {
  projectId: number;
  questions: SurveyQuestion[];
  open: boolean;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => toDrafts(questions));
  const [state, formAction, pending] = useActionState(
    saveSurveyQuestions.bind(null, projectId),
    initialState
  );

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(toDrafts(questions));
    // Only re-derive when the modal is (re-)opened — `questions` is a
    // fresh array reference on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (state.success) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function updateDraft(index: number, patch: Partial<QuestionDraft>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );
  }

  function removeDraft(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
  }

  function addDraft() {
    setDrafts((current) => [
      ...current,
      { id: null, questionText: "", isRequired: true },
    ]);
  }

  function handleSave() {
    const formData = new FormData();
    for (const draft of drafts) {
      formData.append("questionId", draft.id != null ? String(draft.id) : "");
      formData.append("questionText", draft.questionText);
      formData.append("questionRequired", draft.isRequired ? "true" : "false");
    }
    startTransition(() => {
      formAction(formData);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Survey Questions">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-500">
          Asked on every Daily Log submitted for this project.
        </p>

        {state.error && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {drafts.length === 0 ? (
            <p className="rounded border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400">
              No Survey questions yet.
            </p>
          ) : (
            drafts.map((draft, index) => (
              <QuestionRow
                key={draft.id ?? `new-${index}`}
                draft={draft}
                onChange={(patch) => updateDraft(index, patch)}
                onRemove={() => removeDraft(index)}
              />
            ))
          )}
        </div>

        <button
          type="button"
          onClick={addDraft}
          className="flex cursor-pointer items-center gap-1.5 self-start rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          <Plus className="size-4" />
          Add Question
        </button>

        <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || drafts.some((d) => !d.questionText.trim())}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function QuestionRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: QuestionDraft;
  onChange: (patch: Partial<QuestionDraft>) => void;
  onRemove: () => void;
}) {
  const toggleId = useId();
  return (
    <div className="flex items-center gap-3 rounded border border-zinc-200 px-3 py-2">
      <input
        type="text"
        value={draft.questionText}
        onChange={(e) => onChange({ questionText: e.target.value })}
        placeholder="Question text"
        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
      />

      <label
        htmlFor={toggleId}
        className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-500"
      >
        Required
        <span className="relative inline-flex h-5 w-9 flex-shrink-0 items-center">
          <input
            id={toggleId}
            type="checkbox"
            checked={draft.isRequired}
            onChange={(e) => onChange({ isRequired: e.target.checked })}
            className="peer sr-only"
          />
          <span className="absolute inset-0 cursor-pointer rounded-full bg-zinc-200 transition peer-checked:bg-zinc-900" />
          <span className="absolute left-0.5 size-4 rounded-full bg-white transition peer-checked:translate-x-4" />
        </span>
      </label>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Delete question"
        className="flex-shrink-0 cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
