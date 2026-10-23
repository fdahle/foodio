<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api.js'
import { me } from '../session.js'
import WorldMap from '../components/WorldMap.vue'
import DishRow from '../components/DishRow.vue'

// What everyone who shares their stats eats, without names (api/group.js). Only for those who share their own:
// everyone else gets the offer to join.
const data = ref(null)
const error = ref('')
const busy = ref(false)

async function load() {
  error.value = ''
  if (!me.shareStats) return
  try {
    data.value = await api('/group-stats')
  } catch (e) {
    error.value = e.message
  }
}
onMounted(load)

async function setSharing(on) {
  if (!on && !confirm('Stop sharing? Your progress no longer counts in the group stats, and you can’t see them until you share again.')) return
  busy.value = true
  error.value = ''
  try {
    me.shareStats = (await api('/stats-sharing', { method: 'PUT', body: { on } })).shareStats
    data.value = null
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const people = n => `${n} ${n === 1 ? 'person' : 'people'}`
</script>

<template>
  <h1>Stats</h1>
  <p v-if="error" class="error">{{ error }}</p>

  <section v-if="!me.shareStats" class="card stack intro">
    <span class="big-emoji">📊</span>
    <h3>See what everyone eats</h3>
    <p class="muted">
      The favourite cuisines and dishes of everyone on Foodio, what the group has tried together, and which dishes
      only you have had. It’s for those who share: your progress and ratings count in the numbers too.
    </p>
    <p class="muted">
      Never with your name, and your notes stay private. A number only shows once at least 3 people are behind it,
      so nobody can be picked out. You can stop sharing any time.
    </p>
    <div><button class="btn primary" :disabled="busy" @click="setSharing(true)">Share my stats</button></div>
  </section>

  <section v-else-if="data && !data.enough" class="card stack intro">
    <span class="big-emoji">⏳</span>
    <h3>Not enough people yet</h3>
    <p class="muted">
      {{ people(data.people) }} {{ data.people === 1 ? 'shares' : 'share' }} their stats so far. The group stats start
      at {{ data.minPeople }}, so that nobody can be picked out. Ask your friends to turn on sharing here or in Settings.
    </p>
  </section>

  <template v-else-if="data">
    <p class="muted lead">From the {{ people(data.people) }} who share their stats, you included. No names, and only numbers with at least {{ data.minPeople }} people behind them.</p>

    <div class="tiles">
      <div class="tile"><b>{{ data.totals.tried }}</b><span class="muted">of {{ data.totals.dishes }} dishes tried by someone</span></div>
      <div class="tile"><b>{{ data.totals.cuisinesStarted }}</b><span class="muted">of {{ data.totals.cuisines }} cuisines started</span></div>
      <div class="tile"><b>{{ data.totals.average }}</b><span class="muted">dishes per person on average</span></div>
      <div class="tile"><b>{{ data.totals.yours }}</b><span class="muted">dishes tried by you</span></div>
    </div>

    <WorldMap :cuisines="data.map" title="Together on the map" class="block" />

    <div class="two">
      <section class="card block">
        <h3>Favourite cuisines</h3>
        <p class="muted note">Average rating; each person’s average counts once.</p>
        <div class="list">
          <router-link v-for="c in data.lovedCuisines" :key="c.id" :to="`/cuisine/${c.id}`" class="list-item">
            <span class="grow">{{ c.emoji }} {{ c.name }}</span>
            <span class="stat"><b>★ {{ c.rating.toFixed(1) }}</b> <span class="muted">· {{ c.people }}</span></span>
          </router-link>
          <p v-if="!data.lovedCuisines.length" class="empty">No cuisine rated by {{ data.minPeople }} people yet.</p>
        </div>
      </section>
      <section class="card block">
        <h3>Most explored cuisines</h3>
        <p class="muted note">People who tried something from it, then dishes tried.</p>
        <div class="list">
          <router-link v-for="c in data.popularCuisines" :key="c.id" :to="`/cuisine/${c.id}`" class="list-item">
            <span class="grow">{{ c.emoji }} {{ c.name }}</span>
            <span class="stat"><b>{{ people(c.people) }}</b> <span class="muted">· {{ c.tries }} dishes</span></span>
          </router-link>
          <p v-if="!data.popularCuisines.length" class="empty">No cuisine tried by {{ data.minPeople }} people yet.</p>
        </div>
      </section>
    </div>

    <div class="two">
      <section class="card block">
        <h3>Most loved dishes</h3>
        <div class="list scroll">
          <DishRow v-for="d in data.lovedDishes" :key="d.id" :dish="d" :mark="false">
            <span class="stat"><b>★ {{ d.rating.toFixed(1) }}</b> <span class="muted">· {{ d.people }}</span></span>
          </DishRow>
          <p v-if="!data.lovedDishes.length" class="empty">No dish rated by {{ data.minPeople }} people yet.</p>
        </div>
      </section>
      <section class="card block">
        <h3>Most tried dishes</h3>
        <div class="list scroll">
          <DishRow v-for="d in data.mostTried" :key="d.id" :dish="d" :mark="false">
            <span class="stat"><span v-if="d.status === 'tried'" class="mine">✓</span> <b>{{ people(d.people) }}</b></span>
          </DishRow>
          <p v-if="!data.mostTried.length" class="empty">No dish tried by {{ data.minPeople }} people yet.</p>
        </div>
      </section>
    </div>

    <div class="two">
      <section class="card block">
        <h3>Most wanted</h3>
        <p class="muted note">On the most wishlists.</p>
        <div class="list scroll">
          <DishRow v-for="d in data.mostWanted" :key="d.id" :dish="d" :mark="false">
            <span class="stat"><span v-if="d.status === 'tried'" class="mine">✓</span> <b>{{ people(d.people) }}</b></span>
          </DishRow>
          <p v-if="!data.mostWanted.length" class="empty">No dish on {{ data.minPeople }} wishlists yet.</p>
        </div>
      </section>
      <section class="card block">
        <h3>Only you <span class="muted count">{{ data.onlyYou.length }}</span></h3>
        <p class="muted note">Dishes you’ve tried and nobody else here has.</p>
        <div class="list scroll">
          <DishRow v-for="d in data.onlyYou" :key="d.id" :dish="d" :mark="false" />
          <p v-if="!data.onlyYou.length" class="empty">Everything you’ve tried, someone else has too.</p>
        </div>
      </section>
    </div>
  </template>

  <p v-if="me.shareStats" class="stop">
    <button class="link muted" :disabled="busy" @click="setSharing(false)">Stop sharing my stats</button>
  </p>
</template>

<style scoped>
h1 { font-size: 1.4rem; margin-bottom: .4rem; }
h3, p { margin: 0; }
.lead { margin-bottom: .75rem; }
.intro { align-items: flex-start; max-width: 560px; }
.big-emoji { font-size: 2.2rem; }
.tile .muted { font-size: .8rem; }
.block { margin-top: .75rem; display: flex; flex-direction: column; gap: .6rem; }
.note { font-size: .8rem; margin-top: -.3rem; }
.count { font-weight: 400; font-size: .85rem; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 .75rem; }
.stat { white-space: nowrap; font-size: .9rem; }
.mine { color: var(--green); font-weight: 700; }
/* Long lists scroll inside their card instead of stretching the page. */
.scroll { max-height: 22rem; overflow-y: auto; overscroll-behavior: contain; }
.stop { margin-top: 1.5rem; text-align: center; }
.stop .link { text-decoration: underline; }
</style>
