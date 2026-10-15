import logo from '../assets/logo.png';

export default function TpLogo({ size = 36 }) {
  return (
    <img
      src={logo}
      alt="Qubiway"
      style={{ width: size, height: size, display: 'block', flexShrink: 0, borderRadius: size * 0.2 }}
    />
  );
}
