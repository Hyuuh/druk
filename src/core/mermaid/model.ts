/** The shapes mermaid's node syntaxes collapse into for a terminal. */
export type NodeShape = 'rect' | 'round' | 'decision' | 'point'

export type EdgeStyle = 'solid' | 'dotted' | 'thick'

export type ArrowHead = 'none' | 'arrow' | 'hollow' | 'filled' | 'open' | 'cross' | 'circle'

export interface GraphNode {
  id: string
  /** Already wrapped: one entry per row inside the box. */
  label: string[]
  shape: NodeShape
}

export interface GraphEdge {
  from: string
  to: string
  label?: string
  style: EdgeStyle
  /** The head at the `to` end, and at the `from` end for the relations that
   * carry one there (class diagrams point their diamonds back at the owner). */
  head: ArrowHead
  tail: ArrowHead
}

export type Direction = 'TD' | 'BT' | 'LR' | 'RL'

/**
 * Flowcharts, state, class and ER diagrams are all a graph of labelled boxes —
 * they differ in the syntax that spells one, not in what gets drawn.
 */
export interface GraphDiagram {
  kind: 'graph'
  direction: Direction
  nodes: GraphNode[]
  edges: GraphEdge[]
  title?: string
}

export interface SequenceParticipant {
  id: string
  label: string
}

export type SequenceEvent =
  | {
      type: 'message'
      from: string
      to: string
      text: string
      style: EdgeStyle
      head: ArrowHead
    }
  | { type: 'note'; targets: string[]; text: string }
  /** `loop`, `alt`, `opt`, `par`, `else`, `end` — drawn as a labelled rule. */
  | { type: 'block'; keyword: string; text: string; closing: boolean }

export interface SequenceDiagram {
  kind: 'sequence'
  participants: SequenceParticipant[]
  events: SequenceEvent[]
  title?: string
}

export interface PieSlice {
  label: string
  value: number
}

export interface PieDiagram {
  kind: 'pie'
  slices: PieSlice[]
  title?: string
  showData: boolean
}

/** A diagram type nothing here draws: the fence falls back to its source. */
export interface UnsupportedDiagram {
  kind: 'unsupported'
  type: string
  reason: string
}

export type Diagram = GraphDiagram | SequenceDiagram | PieDiagram | UnsupportedDiagram
