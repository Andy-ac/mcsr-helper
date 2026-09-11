import { formatSeedForDisplay, isSeedString, normalizeSeedInput } from '@mcsr/shared/seed';
import { useId, useState } from 'react';

export interface SeedInputProps {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder?: string;
  hint?: string;
  invalidMessage?: string;
  required?: boolean;
  disabled?: boolean;
}

/**
 * 世界种子输入框。
 *
 * ⚠️ 这里刻意使用 `inputMode="text"` 而**不是** `type="number"`：
 * 浏览器对 `type="number"` 的处理基于双精度浮点，64 位种子会被静默改写
 * （`7304888896886165976` → `7304888896886166000`）。
 * 详见 packages/shared/src/seed.ts 顶部说明。
 *
 * 输入过程中不打断用户（允许存在中间态）；失焦时才规范化并给出错误。
 */
export function SeedInput({
  value,
  onChange,
  label,
  placeholder,
  hint,
  invalidMessage,
  required = false,
  disabled = false,
}: SeedInputProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [touched, setTouched] = useState(false);

  const trimmed = value.trim();
  const isEmpty = trimmed.length === 0;
  const invalid = touched && !isEmpty && !isSeedString(trimmed);

  return (
    <div className="mcsr-field">
      <label className="mcsr-field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={id}
        className="mcsr-field__input mcsr-field__input--mono"
        // 关键：不是 type="number"
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setTouched(true);
          if (isEmpty) return;
          try {
            const normalized = normalizeSeedInput(value);
            if (normalized !== value) onChange(normalized);
          } catch {
            // 保持用户原样输入，由下面的错误提示告知原因
          }
        }}
      />
      {invalid ? (
        <p className="mcsr-field__error" id={errorId} role="alert">
          {invalidMessage}
        </p>
      ) : isEmpty ? (
        hint ? (
          <p className="mcsr-field__hint">{hint}</p>
        ) : null
      ) : (
        <p className="mcsr-field__hint">
          {/* 回显分组后的数字，方便肉眼核对有没有被截断 */}
          {formatSeedForDisplay(value.trim())}
        </p>
      )}
    </div>
  );
}
