import { useState } from "react";
import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import type { PromptItem } from "../../lib/api";

export function PromptDetailModal({
  prompt,
  onClose,
  onLoad,
  onInsert,
  onDelete,
  onDeleted,
  onToggleFavorite,
}: {
  prompt: PromptItem;
  onClose: () => void;
  onLoad: () => void;
  onInsert: () => void;
  onDelete: () => void;
  onDeleted?: () => void;
  onToggleFavorite: () => void;
}) {
  const { t } = useI18n();
  const updatePromptInLibrary = useAppStore((s) => s.updatePromptInLibrary);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(prompt.name || "");
  const [editText, setEditText] = useState(prompt.text || "");
  const [editTags, setEditTags] = useState(
    prompt.tags ? prompt.tags.join(", ") : "",
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.text);
    } catch {
      // ignore
    }
  };

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    setIsSaving(true);
    try {
      await updatePromptInLibrary(prompt.id, {
        name: editName.trim(),
        text: editText.trim(),
        tags: editTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    onDelete();
    onDeleted?.();
  };

  return (
    <div className="prompt-detail-modal" onClick={onClose}>
      <div className="prompt-detail-modal__backdrop" />
      <div
        className="prompt-detail-modal__content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prompt-detail-modal__header">
          <h4>{prompt.name || t("promptLibrary.untitled")}</h4>
          <button
            type="button"
            className="prompt-detail-modal__close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="prompt-detail-modal__body">
          {isEditing ? (
            <div className="prompt-detail-modal__edit-form">
              <label>
                {t("promptLibrary.name")}
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={prompt.name || t("promptLibrary.untitled")}
                  className="prompt-detail-modal__edit-input"
                />
              </label>
              <label>
                {t("promptLibrary.content")}
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={8}
                  className="prompt-detail-modal__edit-textarea"
                />
              </label>
              <label>
                {t("promptLibrary.tags")}
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="tag1, tag2"
                  className="prompt-detail-modal__edit-input"
                />
              </label>
            </div>
          ) : (
            <>
              <div className="prompt-detail-modal__label">
                {t("promptLibrary.content")}
              </div>
              <div className="prompt-detail-modal__prompt">{prompt.text}</div>

              {prompt.tags.length > 0 && (
                <div className="prompt-detail-modal__tags">
                  <div className="prompt-detail-modal__label">
                    {t("promptLibrary.tags")}
                  </div>
                  <div className="prompt-detail-modal__tag-list">
                    {prompt.tags.map((tag) => (
                      <span key={tag} className="prompt-detail-modal__tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="prompt-detail-modal__footer">
          {isEditing ? (
            <>
              <button
                type="button"
                className="prompt-detail-modal__load"
                onClick={() => setIsEditing(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="prompt-detail-modal__insert"
                onClick={() => void handleSaveEdit()}
                disabled={isSaving || !editText.trim()}
              >
                {isSaving ? t("common.saving") : t("common.save")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="prompt-detail-modal__load" onClick={onLoad}>
                {t("promptLibrary.load")}
              </button>
              <button
                type="button"
                className="prompt-detail-modal__copy"
                onClick={handleCopy}
              >
                {t("promptLibrary.copy")}
              </button>
              <button
                type="button"
                className="prompt-detail-modal__insert"
                onClick={onInsert}
              >
                + {t("promptLibrary.insert")}
              </button>
              <button
                type="button"
                className={`prompt-detail-modal__favorite${prompt.isFavorite ? " prompt-detail-modal__favorite--on" : ""}`}
                onClick={onToggleFavorite}
              >
                {prompt.isFavorite
                  ? "★ " + t("promptLibrary.unfavorite")
                  : "☆ " + t("promptLibrary.favorite")}
              </button>
              <button
                type="button"
                className="prompt-detail-modal__edit"
                onClick={() => setIsEditing(true)}
              >
                {t("common.edit")}
              </button>
              <button
                type="button"
                className="prompt-detail-modal__delete"
                onClick={handleDelete}
              >
                {t("common.delete")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
