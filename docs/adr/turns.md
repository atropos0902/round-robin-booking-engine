# How turns are shared

## The problem

"Pick whoever has the fewest meetings for their weight" looks right and has two faults. A new host, or one back from leave, has few meetings and gets every booking until they catch up. And with uneven weights some hosts run well ahead of their share before it evens out.

## How it works

Each host has a balance in millionths of a turn. For every meeting the free hosts of the highest priority split one turn by weight, and the host who takes the meeting pays one turn. Balances in a rotation always add up to zero.

Among the hosts with a positive balance the turn goes to the one whose next whole turn falls due first. That is the quota method of Balinski and Young, known from sharing out seats in a parliament. With a stable group nobody is ever a full turn away from their exact share, ahead or behind.

Hosts who are not free earn nothing for that meeting. A week of leave costs a host that week's meetings and nothing more.

A cancelled meeting is undone exactly, with the shares saved in the decision.

## The price

- The bound only holds while the same hosts are free. When availability keeps changing, a host can drift by more than a turn. Balances still add up to zero.
- A host who leaves takes their balance with them. The others are then off by less than a turn between them.
- Millionths round. After about a million meetings the rounding could add up to one turn.

## Why not the largest balance

It is simpler, and there are weights where a host then falls more than a turn behind. The property test finds them as soon as the due-first rule is taken out.
