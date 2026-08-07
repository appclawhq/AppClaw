# Structured YAML selectors and assertions

AppClaw YAML flows support a deterministic accessibility-tree lane alongside the existing
natural-language and vision lanes. A structured selector never silently falls back to vision.
This makes state checks and repeated CI runs predictable while preserving legacy flow syntax.

## Actions

Legacy string actions keep their existing fuzzy matching behavior:

```yaml
- tap: Login
```

Use an object to opt into exact structured matching:

```yaml
steps:
  - tap:
      target:
        id: login_button
        enabled: true

  - type:
      value: ${secrets.email}
      into:
        accessibilityId: email_input

  - doubleTap:
      text: Photo
      index: 1

  - longPress:
      target:
        accessibilityId: item_menu
      duration: 1500
```

Structured selectors support these identity and state fields:

- `text`, `id`, `accessibilityId`, `type`, `hint`, `value`
- `enabled`, `checked`, `focused`, `selected`
- `editable`, `clickable`, `scrollable`, `longClickable`
- `index` (zero-based, applied after all other filters)

String shorthand is exact and case-insensitive. Use an explicit matcher for contains or regex:

```yaml
- tap:
    text:
      value: '^Add to cart \\([0-9]+\\)$'
      match: regex # exact | contains | regex
      caseSensitive: false
```

Action selectors must resolve to exactly one visible element. If several elements match, add an
`index` or relation. AppClaw reports ambiguity instead of silently choosing the first match.

On Android, an element with a stable `resource-id` remains selectable even when UiAutomator2
reports `clickable=false` and exposes no `text` or `content-desc`. This pattern is common when a
parent gesture layer handles the tap while a child container carries the ID and bounds. Structured
tap actions use the uniquely resolved element's center coordinates, so no vision fallback is needed:

```yaml
- tap:
    id: com.example:id/ask_ai_container
```

Empty, non-interactive Android layout nodes without a `resource-id` are still filtered out.

## Spatial and tree relations

Relations accept text shorthand or a nested selector:

```yaml
- tap:
    text: Submit
    below:
      id: password_input

- tap:
    accessibilityId: disclosure_icon
    descendantOf:
      id: account_row
```

Available relations:

- Geometry: `above`, `below`, `leftOf`, `rightOf`, `near`, `within`
- Accessibility hierarchy: `childOf`, `descendantOf`

Relations can be nested to disambiguate the anchor itself.

## Property and count assertions

Keep target identity separate from expected state so failures can report expected and actual
values:

```yaml
assertions:
  - assert:
      target:
        id: remember_me
      properties:
        visible: true
        checked: true
        enabled: true

  - assert:
      target:
        type: Cell
      count:
        gte: 1

  - assert:
      target:
        id: checkout_card
      properties:
        width:
          gte: 280
          lte: 360
        height:
          equals: 180
          tolerance: 4
        x:
          min: 0
        y:
          max: 1200
```

Property assertions support:

- Presence: `exists`, `visible`
- Content: `text`, `value`, `type`
- State: `enabled`, `checked`, `focused`, `selected`, `editable`, `clickable`, `scrollable`,
  `longClickable`
- Geometry: `width`, `height`, `x`, `y`

Numeric expectations accept a number or `equals`, `gte`/`lte`, `min`/`max`, and `tolerance`.
Count assertions use the same numeric matcher.

Convenience aliases are available for visibility checks:

```yaml
- assertVisible:
    id: dashboard

- assertNotVisible:
    id: loading_spinner
```

`visible: false` passes when no matching visible node is present. `exists: false` is stricter and
passes only when no matching node exists at all. When a platform does not expose a state such as
`checked`, AppClaw reports it as unavailable instead of treating it as `false`.

## Deterministic waits and scrolling

```yaml
- waitUntil:
    visible:
      id: dashboard
    timeout: 15

- waitUntil:
    gone:
      id: loading_spinner
    timeout: 30

- scrollAssert:
    target:
      id: legal_footer
    direction: down
    maxScrolls: 4
```

Structured waits and scroll assertions use only the current Android/iOS accessibility tree.
Natural-language string assertions retain the existing DOM-first/vision-fallback behavior.

## Reports

Run manifests and HTML inspectors include the structured selector, matched count, matched element
snapshots, expected properties/count, and individual failure reasons. Secure input values are
masked in selector diagnostics.
