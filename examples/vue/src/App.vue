<script setup lang="ts">
import * as SkillIcons from '@skill-icons/vue';

// Get all icon components
const iconEntries = Object.entries(SkillIcons);
</script>

<template>
  <div class="app-container">
    <h1 class="title">Skill Icons Library</h1>
    <p class="subtitle">Total {{ iconEntries.length }} Icons</p>
    <div class="icons-grid">
      <div v-for="[iconName, IconComponent] in iconEntries" :key="iconName" class="icon-card">
        <div class="icon-container">
          <component :is="IconComponent" />
        </div>
        <span class="icon-name">
          {{ iconName }}
        </span>
      </div>
    </div>
  </div>
</template>
