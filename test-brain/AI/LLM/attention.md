# Attention Mechanism

## Core Idea

The attention mechanism allows a model to focus on different parts of the input sequence when producing each part of the output. Instead of compressing the entire input into a single fixed-size vector, attention lets the model "look back" at all input positions.

## Scaled Dot-Product Attention

The fundamental operation:

```
Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V
```

- **Q (Query)**: What am I looking for?
- **K (Key)**: What do I contain?
- **V (Value)**: What information do I provide?

The scaling factor `sqrt(d_k)` prevents the dot products from growing too large.

## Multi-Head Attention

Instead of performing a single attention function, multi-head attention runs multiple attention operations in parallel:

1. Project Q, K, V with different learned linear projections
2. Perform attention on each "head"
3. Concatenate the results
4. Apply a final linear projection

## Self-Attention

When Q, K, and V all come from the same sequence, it's called **self-attention**. Each position can attend to every other position, capturing long-range dependencies.

## Key Insight

Attention replaced recurrence as the primary mechanism for capturing long-range dependencies, leading directly to the Transformer architecture.
