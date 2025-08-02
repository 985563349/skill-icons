import * as SkillIcons from '@skill-icons/react';

function App() {
  // Get all icon components
  const iconEntries = Object.entries(SkillIcons);

  return (
    <div className="app-container">
      <h1 className="title">Skill Icons Library</h1>
      <p className="subtitle">Total {iconEntries.length} Icons</p>
      <div className="icons-grid">
        {iconEntries.map(([iconName, IconComponent]) => (
          <div key={iconName} className="icon-card">
            <div className="icon-container">
              <IconComponent />
            </div>
            <span className="icon-name">{iconName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
