create table if not exists milk_village_state (
  id text primary key,
  data text not null,
  updated_at text not null
);

create table if not exists milk_village_state_chunks (
  state_id text not null,
  chunk_index integer not null,
  data_chunk text not null,
  primary key (state_id, chunk_index),
  foreign key (state_id) references milk_village_state(id) on delete cascade
);
