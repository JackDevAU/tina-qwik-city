import {
  useSignal,
  useVisibleTask$,
  useComputed$,
  type Signal,
} from "@builder.io/qwik";

export function useTina<T extends object>(props: {
  query: string;
  variables: object;
  data: T;
}): { data: Signal<T>; isClient: Signal<boolean> } {
  const stringifiedQuery = JSON.stringify({
    query: props.query,
    variables: props.variables,
  });

  const id = useComputed$(() => hashFromQuery(stringifiedQuery));

  const data = useSignal<T>(props.data);
  const isClient = useSignal(false);
  const quickEditEnabled = useSignal(false);
  const isInTinaIframe = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => id.value);

    isClient.value = true;
    data.value = props.data;
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    if (quickEditEnabled.value) {
      const style = document.createElement("style");
      style.type = "text/css";
      style.textContent = `
        [data-tina-field] {
          outline: 2px dashed rgba(34,150,254,0.5);
          transition: box-shadow ease-out 150ms;
        }
        [data-tina-field]:hover {
          box-shadow: inset 100vi 100vh rgba(34,150,254,0.3);
          outline: 2px solid rgba(34,150,254,1);
          cursor: pointer;
        }
        [data-tina-field-overlay] {
          outline: 2px dashed rgba(34,150,254,0.5);
          position: relative;
        }
        [data-tina-field-overlay]:hover {
          cursor: pointer;
          outline: 2px solid rgba(34,150,254,1);
        }
        [data-tina-field-overlay]::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 20;
          transition: opacity ease-out 150ms;
          background-color: rgba(34,150,254,0.3);
          opacity: 0;
        }
        [data-tina-field-overlay]:hover::after {
          opacity: 1;
        }
      `;
      document.head.appendChild(style);
      document.body.classList.add("__tina-quick-editing-enabled");

      const mouseDownHandler = function (e: MouseEvent) {
        const target = e.target as HTMLElement;
        const attributeNames = target.getAttributeNames();
        const tinaAttribute = attributeNames.find((name) =>
          name.startsWith("data-tina-field")
        );
        let fieldName;
        if (tinaAttribute) {
          e.preventDefault();
          e.stopPropagation();
          fieldName = target.getAttribute(tinaAttribute);
        } else {
          const ancestor = target.closest(
            "[data-tina-field], [data-tina-field-overlay]"
          ) as HTMLElement | null;
          if (ancestor) {
            const attributeNames = ancestor.getAttributeNames();
            const tinaAttribute = attributeNames.find((name) =>
              name.startsWith("data-tina-field")
            );
            if (tinaAttribute) {
              e.preventDefault();
              e.stopPropagation();
              fieldName = ancestor.getAttribute(tinaAttribute);
            }
          }
        }
        if (fieldName) {
          if (isInTinaIframe.value) {
            window.parent.postMessage(
              { type: "field:selected", fieldName: fieldName },
              window.location.origin
            );
          } else {
            // if (preview?.redirect) {
            //   const tinaAdminBasePath = preview.redirect.startsWith('/')
            //     ? preview.redirect
            //     : `/${preview.redirect}`
            //   const tinaAdminPath = `${tinaAdminBasePath}/index.html#/~${window.location.pathname}?active-field=${fieldName}`
            //   window.location.assign(tinaAdminPath)
            // }
          }
        }
      };

      document.addEventListener("click", mouseDownHandler, true);

      cleanup(() => {
        document.removeEventListener("click", mouseDownHandler, true);
        document.body.classList.remove("__tina-quick-editing-enabled");
        style.remove();
      });
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    window.parent.postMessage(
      { type: "open", ...props, id: id.value },
      window.location.origin
    );

    const messageHandler = (event: MessageEvent) => {
      if (event.data.type === "quickEditEnabled") {
        quickEditEnabled.value = event.data.value;
      }
      if (event.data.id === id.value && event.data.type === "updateData") {
        data.value = event.data.data;
        isInTinaIframe.value = true;
        // Ensure we still have a tina-field on the page
        const anyTinaField = document.querySelector("[data-tina-field]");
        if (anyTinaField) {
          window.parent.postMessage(
            { type: "quick-edit", value: true },
            window.location.origin
          );
        } else {
          window.parent.postMessage(
            { type: "quick-edit", value: false },
            window.location.origin
          );
        }
      }
    };

    window.addEventListener("message", messageHandler);

    cleanup(() => {
      window.removeEventListener("message", messageHandler);
      window.parent.postMessage(
        { type: "close", id: id.value },
        window.location.origin
      );
    });
  });

  return { data, isClient };
}

export function useEditState(): { edit: Signal<boolean> } {
  const edit = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    if (typeof window !== "undefined") {
      window.parent.postMessage({ type: "isEditMode" }, window.location.origin);
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "tina:editMode") {
          edit.value = true;
        }
      };
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }
  });

  return { edit };
}

/**
 * Grab the field name for the given attribute
 * to signal to Tina which DOM element the field
 * is working with.
 */
export const tinaField = <
  T extends
    | (object & {
        _content_source?: {
          queryId: string;
          path: (number | string)[];
        };
      })
    | undefined
    | null,
>(
  object: T,
  property?: keyof Omit<NonNullable<T>, "__typename" | "_sys">,
  index?: number
) => {
  if (!object) {
    return "";
  }
  if (object._content_source) {
    if (!property) {
      return [
        object._content_source.queryId,
        object._content_source.path.join("."),
      ].join("---");
    }
    if (typeof index === "number") {
      return [
        object._content_source.queryId,
        [...object._content_source.path, property, index].join("."),
      ].join("---");
    }
    return [
      object._content_source.queryId,
      [...object._content_source.path, property].join("."),
    ].join("---");
  }
  return "";
};

export const addMetadata = <T extends object>(
  id: string,
  object: T & { type?: string; _content_source?: unknown },
  path: (string | number)[]
): T | undefined => {
  Object.entries(object).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isScalarOrUndefined(item)) {
          return;
        }
        if (Array.isArray(item)) {
          return; // we don't expect arrays of arrays
        }
        const itemObject = item as object;
        addMetadata(id, itemObject, [...path, key, index]);
      });
    } else {
      if (isScalarOrUndefined(value)) {
        return;
      }
      const itemObject = value as object;
      addMetadata(id, itemObject, [...path, key]);
    }
  });
  // This is a rich-text field object
  if (object.type === "root") {
    return;
  }

  object._content_source = {
    queryId: id,
    path,
  };
  return object;
};
function isScalarOrUndefined(value: unknown) {
  const type = typeof value;
  if (type === "string") return true;
  if (type === "number") return true;
  if (type === "boolean") return true;
  if (type === "undefined") return true;

  if (value == null) return true;
  if (value instanceof String) return true;
  if (value instanceof Number) return true;
  if (value instanceof Boolean) return true;

  return false;
}

/**
 * This is a pretty rudimentary approach to hashing the query and variables to
 * ensure we treat multiple queries on the page uniquely. It's possible
 * that we would have collisions, and I'm not sure of the likeliness but seems
 * like it'd be rare.
 */
export const hashFromQuery = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) & 0xffffffff; // Apply bitwise AND to ensure non-negative value
  }
  const nonNegativeHash = Math.abs(hash);
  const alphanumericHash = nonNegativeHash.toString(36);
  return alphanumericHash;
};
